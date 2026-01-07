const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ========== ABOUT ==========

/*

Given the latest broadcast file,
Updates the deployment history and latest data for the chain.

Note: Only TransparentUpgradeableProxy by OpenZeppelin is supported at the moment.

*/

// Note: Do not force in production.
async function extractAndSaveJson(scriptName, chainId, rpcUrl, force, broadcastDir, outDir, tags = {}, tagAddresses = {}) {
  // ========== PREPARE FILES ==========

  // Latest broadcast
  const filePath = path.join(__dirname, `../../${broadcastDir}/${scriptName}/${chainId}/run-latest.json`);
  const jsonData = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  // Previously extracted data
  const recordFilePath = path.join(__dirname, `../../deployments/json/${chainId}.json`);
  let recordData;

  // Try to read previously extracted data
  try {
    recordData = JSON.parse(fs.readFileSync(recordFilePath, "utf8"));
  } catch (error) {
    // If the file doesn't exist, create a new JSON
    recordData = {
      chainId: chainId,
      latest: {},
      history: [],
    };
  }

  // Abort if commit processed
  if (recordData.history.length > 0) {
    const latestEntry = recordData.history[0];
    if (latestEntry.commitHash === jsonData.commit && !force) {
      console.error(`Commit ${jsonData.commit} already processed. Aborted.`);
      process.exit(1);
    }
  }

  // Generate Forge artifacts
  prepareArtifacts();

  // ========== UPDATE LATEST ==========

  const upgradeableTemplate = {
    implementation: "",
    address: "",
    proxy: true,
    version: "",
    proxyType: "TransparentUpgradeableProxy",
    deploymentTxn: "",
    proxyAdmin: "",
    initcodeHash: "",
    input: {},
  };

  const nonUpgradeableTemplate = {
    address: "",
    proxy: false,
    version: "",
    deploymentTxn: "",
    initcodeHash: "",
    input: {},
  };

  // Filter CREATE transactions
  const createTransactions = jsonData.transactions.filter((transaction) => {
    return transaction.transactionType === "CREATE" || transaction.transactionType === "CREATE2";
  });

  // For history
  const contracts = {};

  // Iterate over transactions
  for (let i = 0; i < createTransactions.length; i++) {
    const currentTransaction = createTransactions[i];
    const contractName = currentTransaction.contractName;

    // CASE: Contract name not unique
    if (contractName === null) {
      console.log("Contract name not unique or not found. Skipping.");
      continue;
    }

    // ====== TYPE: CONTRACT NOT PROXY =====
    if (contractName !== "TransparentUpgradeableProxy") {
      let duplicate = false;
      for (let j = 0; j < recordData.history.length; j++) {
        const historyItem = recordData.history[j];
        if (historyItem.contracts.hasOwnProperty(contractName)) {
          const historyContract = historyItem.contracts[contractName];
          if (
            historyContract.address === currentTransaction.contractAddress &&
            historyContract.deploymentTxn === currentTransaction.hash
          ) {
            // CASE: Contract already processed
            duplicate = true;
            break;
          }
        }
      }
      if (duplicate) {
        console.log(`Skipping duplicate contract ${contractName}.`);
        continue;
      }

      // Contract exists in latest
      if (recordData.latest.hasOwnProperty(contractName)) {
        const matchedItem = recordData.latest[contractName];

        // The latest is upgradeable
        if (matchedItem.proxy) {
          // CASE: Unused implementation
          if (
            (await getImplementation(matchedItem.address, rpcUrl)).toLowerCase() !==
            currentTransaction.contractAddress.toLowerCase()
          ) {
            console.error(`${contractName} not upgraded to ${currentTransaction.contractAddress}. Aborted.`);
            process.exit(1);
          }

          // CASE: New implementation
          const upgradeableItem = {
            ...upgradeableTemplate,
            implementation: currentTransaction.contractAddress,
            proxyAdmin: matchedItem.proxyAdmin,
            address: matchedItem.address,
            proxy: true,
            version: await getVersion(matchedItem.address, rpcUrl),
            proxyType: matchedItem.proxyType,
            deploymentTxn: matchedItem.deploymentTxn,
            initcodeHash: computeInitcodeHash(currentTransaction.transaction.input),
            input: {
              constructor: matchConstructorInputs(getABI(contractName, outDir), currentTransaction.arguments),
            },
          };

          // Append it to history item
          const storageKey1 = getStorageKey(contractName, upgradeableItem.initcodeHash);
          contracts[storageKey1] = upgradeableItem;
          // Update latest item
          let copyOfUpgradeableItem = { ...upgradeableItem };
          delete copyOfUpgradeableItem.input;
          copyOfUpgradeableItem.timestamp = jsonData.timestamp;
          copyOfUpgradeableItem.commitHash = jsonData.commit;
          recordData.latest[storageKey1] = copyOfUpgradeableItem;
        } else {
          // The latest wasn't upgradeable
          // CASE: Existing non-upgradeable contract
          const nonUpgradeableItem = {
            ...nonUpgradeableTemplate,
            address: currentTransaction.contractAddress,
            version: await getVersion(currentTransaction.contractAddress, rpcUrl),
            deploymentTxn: currentTransaction.hash,
            initcodeHash: computeInitcodeHash(currentTransaction.transaction.input),
            input: {
              constructor: matchConstructorInputs(getABI(contractName, outDir), currentTransaction.arguments),
            },
          };

          // Append it to history item
          const storageKey2 = getStorageKey(contractName, nonUpgradeableItem.initcodeHash);
          contracts[storageKey2] = nonUpgradeableItem;
          // Update latest item
          let copyOfNonUpgradeableItem = { ...nonUpgradeableItem };
          delete copyOfNonUpgradeableItem.input;
          copyOfNonUpgradeableItem.timestamp = jsonData.timestamp;
          copyOfNonUpgradeableItem.commitHash = jsonData.commit;
          recordData.latest[storageKey2] = copyOfNonUpgradeableItem;
        }
      } else {
        // Contract didn't exist in latest

        // Search for proxy in subsequent transactions
        let proxyFound = false;

        for (let j = i + 1; j < createTransactions.length; j++) {
          const nextTransaction = createTransactions[j];
          // Proxy found
          if (
            nextTransaction.contractName === "TransparentUpgradeableProxy" &&
            nextTransaction.arguments[0].toLowerCase() === currentTransaction.contractAddress.toLowerCase()
          ) {
            // CASE: New upgradeable contract
            const upgradeableItem = {
              ...upgradeableTemplate,
              implementation: currentTransaction.contractAddress,
              proxyAdmin: nextTransaction.additionalContracts[0]?.address,
              address: nextTransaction.contractAddress,
              proxy: true,
              version: await getVersion(nextTransaction.contractAddress, rpcUrl),
              proxyType: nextTransaction.contractName,
              deploymentTxn: nextTransaction.hash,
              initcodeHash: computeInitcodeHash(currentTransaction.transaction.input),
              input: {
                constructor: matchConstructorInputs(getABI(contractName, outDir), currentTransaction.arguments),
                initializeData: nextTransaction.arguments[2],
              },
            };

            // Append it to history item
            const storageKey3 = getStorageKey(contractName, upgradeableItem.initcodeHash);
            contracts[storageKey3] = upgradeableItem;
            // Update latest item
            let copyOfUpgradeableItem = { ...upgradeableItem };
            delete copyOfUpgradeableItem.input;
            copyOfUpgradeableItem.timestamp = jsonData.timestamp;
            copyOfUpgradeableItem.commitHash = jsonData.commit;
            recordData.latest[storageKey3] = copyOfUpgradeableItem;

            proxyFound = true;
          }
        }
        // Didn't find proxy
        if (!proxyFound) {
          // CASE: New non-upgradeable contract
          const nonUpgradeableItem = {
            ...nonUpgradeableTemplate,
            address: currentTransaction.contractAddress,
            version: await getVersion(currentTransaction.contractAddress, rpcUrl),
            deploymentTxn: currentTransaction.hash,
            initcodeHash: computeInitcodeHash(currentTransaction.transaction.input),
            input: {
              constructor: matchConstructorInputs(getABI(contractName, outDir), currentTransaction.arguments),
            },
          };

          // Append it to history item
          const storageKey4 = getStorageKey(contractName, nonUpgradeableItem.initcodeHash);
          contracts[storageKey4] = nonUpgradeableItem;
          // Update latest item
          let copyOfNonUpgradeableItem = { ...nonUpgradeableItem };
          delete copyOfNonUpgradeableItem.input;
          copyOfNonUpgradeableItem.timestamp = jsonData.timestamp;
          copyOfNonUpgradeableItem.commitHash = jsonData.commit;
          recordData.latest[storageKey4] = copyOfNonUpgradeableItem;
        }
      }
    } else {
      // ===== TYPE: PROXY =====
      // Check if proxy has been processed
      const proxies = Object.values(recordData.latest);
      const proxyExists = proxies.find(({ address }) => address === currentTransaction.contractAddress);

      if (!proxyExists) {
        // CASE: Unexpected proxy
        console.warn(`Unexpected proxy ${currentTransaction.contractAddress}. Skipping.`);
        continue;
      }
    }
  }

  // ========== PREPEND TO HISTORY ==========
  if (Object.keys(contracts).length === 0) {
    console.log("No new contracts found.");
    return;
  }

  recordData.history.push({
    contracts,
    timestamp: jsonData.timestamp,
    commitHash: jsonData.commit,
  });

  // sort recordData.history by timestamp
  recordData.history.sort((a, b) => b.timestamp - a.timestamp);

  // ========== APPLY DUPLICATE TAGS ==========
  recordData.latest = applyDuplicateTags(recordData.latest, tags, tagAddresses);
  recordData.history = applyDuplicateTagsToHistory(recordData.history, tags, tagAddresses);

  // ========== SAVE CHANGES ==========

  // Create file if it doesn't exist
  const directoryPath = path.dirname(recordFilePath);
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }

  // Write to file
  fs.writeFileSync(recordFilePath, JSON.stringify(recordData, null, 2), "utf8");

  return recordData;
}

// ========== HELPERS ==========

// Generate a unique key for storing in latest (uses initcode hash to prevent overwrites)
function getStorageKey(contractName, initcodeHash) {
  if (initcodeHash) {
    return `${contractName}#${initcodeHash.slice(0, 8)}`;
  }
  return contractName;
}

// IN: contract address and RPC URL
// OUT: contract version string
async function getVersion(contractAddress, rpcUrl) {
  if (rpcUrl === undefined) return undefined;
  try {
    return execSync(`cast call ${contractAddress} 'version()(string)' --rpc-url ${rpcUrl}`, {
      encoding: "utf-8",
    })
      .trim()
      .replaceAll('"', "");
  } catch (e) {
    return undefined;
  }
}

// IN: contract address and RPC URL
// OUT: implementation address
async function getImplementation(contractAddress, rpcUrl) {
  if (rpcUrl === undefined) throw new Error("No RPC URL provided, cannot verify upgrade was successful. Aborted.");
  try {
    return execSync(
      `cast storage ${contractAddress} '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' --rpc-url ${rpcUrl} | cast parse-bytes32-address`,
      {
        encoding: "utf-8",
      },
    )
      .trim()
      .replaceAll('"', "");
  } catch (e) {
    return undefined;
  }
}

// IN: contract ABI and input values
// OUT: mappings of input names to values
function matchConstructorInputs(abi, inputData) {
  const inputMapping = {};

  const constructorFunc = abi.find((func) => func.type === "constructor");

  if (constructorFunc && inputData) {
    if (constructorFunc.inputs.length !== inputData.length) {
      console.error(`Couldn't match constructor inputs. Aborted.`);
      process.exit(1);
    }

    constructorFunc.inputs.forEach((input, index) => {
      if (input.type === "tuple") {
        // if input is a mapping, extract individual key value pairs
        inputMapping[input.name] = {};
        // trim the brackets and split by comma
        let data = inputData[index].slice(1, inputData[index].length - 2).split(", ");
        for (let i = 0; i < input.components.length; i++) {
          inputMapping[input.name][input.components[i].name] = data[i];
        }
      } else {
        inputMapping[input.name] = inputData[index];
      }
    });
  }

  return inputMapping;
}

// IN: contract name
// OUT: contract ABI
function getABI(contractName, outDir) {
  const filePath = path.join(__dirname, `../../${outDir}/${contractName}.sol/${contractName}.json`);
  const fileData = fs.readFileSync(filePath, "utf8");
  const abi = JSON.parse(fileData).abi;
  return abi;
}

// Note: Ensures contract artifacts are up-to-date.
function prepareArtifacts() {
  execSync("forge build");
}

// Compute full keccak256 hash of initcode (without 0x prefix)
function computeInitcodeHash(initcode) {
  const hash = execSync(`cast keccak "${initcode}"`, { encoding: "utf-8" }).trim();
  return hash.slice(2); // Remove 0x prefix, return full 64-char hash
}

// Get short version (4 bytes = 8 hex chars) for display
function getShortHash(fullHash) {
  return fullHash.slice(0, 8);
}

// Resolve tag: user-provided (matches short or full hash) > short hash
function resolveTag(fullHash, address, tags, tagAddresses) {
  const shortHash = getShortHash(fullHash);
  if (tagAddresses[address.toLowerCase()]) {
    return tagAddresses[address.toLowerCase()];
  }
  // Match against short hash (what user sees and provides)
  if (tags[shortHash.toLowerCase()]) {
    return tags[shortHash.toLowerCase()];
  }
  // Also check full hash in case user provided it
  if (tags[fullHash.toLowerCase()]) {
    return tags[fullHash.toLowerCase()];
  }
  return shortHash;
}

// Get base contract name (without tag)
function getBaseName(name) {
  return name.split("#")[0];
}

// Check if a tag looks like an auto-generated hash (8 hex chars)
function isAutoGeneratedTag(tag) {
  return tag && /^[0-9a-f]{8}$/i.test(tag);
}

// Apply tags to contracts with duplicate names
function applyDuplicateTags(latest, tags, tagAddresses) {
  // Group contracts by base name
  const contractsByName = {};
  for (const [name, data] of Object.entries(latest)) {
    const baseName = getBaseName(name);
    if (!contractsByName[baseName]) contractsByName[baseName] = [];
    const existingTag = name.includes("#") ? name.split("#")[1] : null;
    contractsByName[baseName].push({ name, data, existingTag });
  }

  // Rename duplicates
  const renamedLatest = {};
  for (const [baseName, entries] of Object.entries(contractsByName)) {
    // Check if there's a real conflict (multiple distinct initcode hashes)
    const uniqueHashes = new Set(entries.map((e) => e.data.initcodeHash).filter(Boolean));
    const hasConflict = uniqueHashes.size > 1;

    for (const entry of entries) {
      const hash = entry.data.initcodeHash;

      // Check if user explicitly provided a tag for this entry
      const userTag =
        (hash && (tags[getShortHash(hash).toLowerCase()] || tags[hash.toLowerCase()])) ||
        tagAddresses[entry.data.address.toLowerCase()];

      if (userTag) {
        // User provided a tag - always use it
        renamedLatest[`${baseName}#${userTag}`] = entry.data;
      } else if (entry.existingTag && !isAutoGeneratedTag(entry.existingTag)) {
        // Entry has a human-readable tag (not auto-generated hash) - preserve it
        renamedLatest[`${baseName}#${entry.existingTag}`] = entry.data;
      } else {
        // No user tag - keep untagged (may overwrite if conflict)
        if (hasConflict && renamedLatest[baseName]) {
          const shortHash = hash ? getShortHash(hash) : "unknown";
          console.warn(
            `Warning: Conflict detected for "${baseName}" (hash: ${shortHash}). Overwriting previous entry. Use --tag ${shortHash}:<label> to preserve both.`,
          );
        }
        renamedLatest[baseName] = entry.data;
      }
    }
  }
  return renamedLatest;
}

// Apply tags to history entries (only when there's a conflict)
function applyDuplicateTagsToHistory(history, tags, tagAddresses) {
  // First, collect all contracts across all history to detect conflicts
  const allContracts = {};
  for (const entry of history) {
    for (const [name, data] of Object.entries(entry.contracts)) {
      const baseName = getBaseName(name);
      if (!allContracts[baseName]) allContracts[baseName] = new Set();
      if (data.initcodeHash) allContracts[baseName].add(data.initcodeHash);
    }
  }

  // Determine which base names need tagging (multiple distinct hashes or user provided tag)
  const needsTagging = new Set();
  for (const [baseName, hashes] of Object.entries(allContracts)) {
    if (hashes.size > 1) {
      needsTagging.add(baseName);
    }
  }

  return history.map((entry) => {
    const taggedContracts = {};
    for (const [name, data] of Object.entries(entry.contracts)) {
      const baseName = getBaseName(name);
      const hash = data.initcodeHash;

      // Check if user explicitly provided a tag for this entry
      const hasUserTag =
        (hash && (tags[getShortHash(hash).toLowerCase()] || tags[hash.toLowerCase()])) ||
        tagAddresses[data.address.toLowerCase()];

      if (needsTagging.has(baseName) || hasUserTag || name.includes("#")) {
        // Needs tagging due to conflict, user tag, or already tagged
        if (hash) {
          const tag = resolveTag(hash, data.address, tags, tagAddresses);
          taggedContracts[`${baseName}#${tag}`] = data;
        } else {
          const addrTag = tagAddresses[data.address.toLowerCase()];
          if (addrTag) {
            taggedContracts[`${baseName}#${addrTag}`] = data;
          } else {
            // Legacy entry without hash in conflict - warn and keep untagged
            taggedContracts[baseName] = data;
          }
        }
      } else {
        // No conflict, keep as base name
        taggedContracts[baseName] = data;
      }
    }
    return { ...entry, contracts: taggedContracts };
  });
}

module.exports = { extractAndSaveJson };
