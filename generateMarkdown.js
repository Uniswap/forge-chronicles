const { execSync } = require("child_process");
const { writeFileSync } = require("fs");
const { join } = require("path");

const projectGitUrl = getProjectUrl();
const projectName = getProjectName();
let explorer;

function generateAndSaveMarkdown(input, explorerUrl) {
  explorer = explorerUrl;
  let out = `# ${projectName}\n\n`;

  out += `\n### Table of Contents\n- [Summary](#summary)\n- [Contracts](#contracts)\n\t- `;
  out += Object.keys(input.latest)
    .map(
      (c) =>
        `[${c.replace(/([A-Z])/g, " $1").trim()}](#${c
          .replace(/([A-Z])/g, "-$1")
          .trim()
          .slice(1)
          .toLowerCase()})`,
    )
    .join("\n\t- ");
  out += `\n- [Deployment History](#deployment-history)`;
  const { deploymentHistoryMd, allVersions } = generateDeploymentHistory(input.history, input.chainId);
  out += Object.keys(allVersions)
    .map((v) => `\n\t- [${v}](#${v.replace(/\. /g, "").replace(/ /g, "-").toLowerCase()})`)
    .join("");

  out += `\n\n## Summary
<table>
<tr>
    <th>Contract</th>
    <th>Address</th>
    <th>Version</th>
</tr>`;
  out += Object.entries(input.latest)
    .map(
      ([contractName, { address, version }]) =>
        `<tr>
    <td>${contractName}</td>
    <td>${getEtherscanLinkAnchor(input.chainId, address)}</td>
    <td>${version || `N/A`}</td>
    </tr>`,
    )
    .join("\n");
  out += `</table>\n`;

  out += `\n## Contracts\n\n`;

  out += Object.entries(input.latest)
    .map(
      ([
        contractName,
        { address, deploymentTxn, version, commitHash, timestamp, proxyType, implementation, proxyAdmin },
      ]) => `### ${contractName.replace(/([A-Z])/g, " $1").trim()}
  
Address: ${getEtherscanLinkMd(input.chainId, address)}
  
${deploymentTxn ? `Deployment Transaction: ${getEtherscanLinkMd(input.chainId, deploymentTxn, "tx")}` : ""}
  
${typeof version === "undefined" ? "" : `Version: [${version}](${projectGitUrl}/releases/tag/${version})`}
  
${commitHash ? `Commit Hash: [${commitHash.slice(0, 7)}](${projectGitUrl}/commit/${commitHash})` : ``}
  
${prettifyTimestamp(timestamp)}
${generateProxyInformationIfProxy({
  address,
  contractName,
  proxyType,
  implementation,
  proxyAdmin,
  history: input.history,
  chainId: input.chainId,
})}`,
    )
    .join("\n\n---\n\n");

  out += `

## Deployment History
  
${deploymentHistoryMd}`;

  writeFileSync(join(__dirname, `../../deployments/${input.chainId}.md`), out, "utf-8");
  console.log("Generation complete!");
}

function getEtherscanLink(chainId, address, slug = "address") {
  chainId = parseInt(chainId);
  if (explorer) {
    if (!explorer.endsWith("/")) explorer += "/";
    return `${explorer}${slug}/${address}`;
  }
  switch (chainId) {
    case 1:
      return `https://etherscan.io/${slug}/${address}`;
    case 5:
      return `https://goerli.etherscan.io/${slug}/${address}`;
    case 11155111:
      return `https://sepolia.etherscan.io/${slug}/${address}`;
    default:
      return ``;
  }
}
function getEtherscanLinkMd(chainId, address, slug = "address") {
  const etherscanLink = getEtherscanLink(chainId, address, slug);
  return etherscanLink.length ? `[${address}](${etherscanLink})` : address;
}
function getEtherscanLinkAnchor(chainId, address, slug = "address") {
  const etherscanLink = getEtherscanLink(chainId, address, slug);
  return etherscanLink.length ? `<a href="${etherscanLink}" target="_blank">${address}</a>` : address;
}

function generateProxyInformationIfProxy({
  address,
  contractName,
  proxyType,
  implementation,
  proxyAdmin,
  history,
  chainId,
}) {
  let out = ``;
  if (typeof proxyType === "undefined") return out;
  out += `\n\n_Proxy Information_\n\n`;
  out += `\n\nProxy Type: ${proxyType}\n\n`;
  out += `\n\nImplementation: ${getEtherscanLinkMd(chainId, implementation)}\n\n`;
  if (proxyAdmin) out += `\n\nProxy Admin: ${getEtherscanLinkMd(chainId, proxyAdmin)}\n\n`;

  const historyOfProxy = history.filter((h) => h?.contracts[contractName]?.address === address);
  if (historyOfProxy.length === 0) return out;
  out += `\n`;
  out += `
  <details>
  <summary>Implementation History</summary>
  <table>
      <tr>
          <th>Version</th>
          <th>Address</th>
          <th>Commit Hash</th>
      </tr>${historyOfProxy
        .map(
          ({
            contracts: {
              [contractName]: { implementation, version },
            },
            commitHash,
          }) => `
      <tr>
          <td>${
            version ? `<a href="${projectGitUrl}/releases/tag/${version}" target="_blank">${version}</a>` : `N/A`
          }</td>
          <td>${getEtherscanLinkAnchor(chainId, implementation)}</td>
          <td>${
            commitHash
              ? `<a href="${projectGitUrl}/commit/${commitHash}" target="_blank">${commitHash.slice(0, 7)}</a>`
              : `N/A`
          }</td>
      </tr>`,
        )
        .join("")}
  </table>
  </details>
    `;
  return out;
}

function generateDeploymentHistory(history, chainId) {
  const ghostVersion = "0.0.0";

  const allVersions = history.reduce((obj, { contracts, timestamp, commitHash }) => {
    const highestVersion = Object.values(contracts).reduce(
      (highest, { version }) => (version && version > highest ? version : highest),
      ghostVersion,
    );
    const key = highestVersion === ghostVersion ? new Date(timestamp * 1000).toDateString() : highestVersion;
    obj[key] = [
      ...(obj[key] || []),
      ...Object.entries(contracts).map(([contractName, contract]) => ({
        contractName,
        contract: { ...contract, timestamp, commitHash },
        highestVersion,
      })),
    ];
    return obj;
  }, {});

  let out = ``;
  out += Object.entries(allVersions)
    .map(
      ([version, contractInfos]) => `
### ${
        contractInfos[0].highestVersion === ghostVersion
          ? version
          : `[${version}](${projectGitUrl}/releases/tag/${version})`
      }
  
  ${contractInfos[0].highestVersion === ghostVersion ? "" : prettifyTimestamp(contractInfos[0].contract.timestamp)}
  
Deployed contracts:
  
${contractInfos
  .map(
    ({ contract, contractName }) => `<details>
  <summary>
    <a href="${getEtherscanLink(chainId, contract.address) || contract.address}">${contractName
      .replace(/([A-Z])/g, " $1")
      .trim()}</a>${
      contract.proxyType
        ? ` (<a href="${
            getEtherscanLink(chainId, contract.implementation) || contract.implementation
          }">Implementation</a>)`
        : ``
    }${
      isTransaction(contract.input.initializationTxn)
        ? ` (<a href="${getEtherscanLink(chainId, contract.input.initializationTxn, "tx")}">Initialization Txn</a>)`
        : ``
    }
  </summary>
  <table>
    ${
      contract.commitHash
        ? `<tr>
      <td>Commit hash: <a href="${projectGitUrl}/commit/${
        contract.commitHash
      }" target="_blank">${contract.commitHash.slice(0, 7)}</a></td>
    </tr>`
        : ``
    }
${
  Object.keys(contract.input.constructor).length
    ? `<tr>
      <th>Parameter</th>
      <th>Value</th>
    </tr>${Object.entries(contract.input.constructor)
      .map(
        ([key, value]) => `
    <tr>
      <td>${key}</td>
      <td>${
        isAddress(value) || isTransaction(value)
          ? getEtherscanLinkAnchor(chainId, value, isTransaction(value) ? "tx" : "address")
          : typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : value
      }</td>
    </tr>`,
      )
      .join("")}
  </table>
`
    : ``
}${
      Object.keys(contract.input.constructor).length
        ? `</details>`
        : `  </table>
</details>`
    }`,
  )
  .join("\n")}    
  `,
    )
    .join("\n\n");

  return { deploymentHistoryMd: out, allVersions };
}

function prettifyTimestamp(timestamp) {
  return new Date(timestamp * 1000).toUTCString().replace("GMT", "UTC") + "\n";
}

function isTransaction(str) {
  return /^0x([A-Fa-f0-9]{64})$/.test(str);
}

function isAddress(str) {
  return /^0x([A-Fa-f0-9]{40})$/.test(str);
}

function getProjectUrl() {
  return execSync(`git remote get-url origin`, { encoding: "utf-8" })
    .trim()
    .replace(/\.git$/, "");
}

function getProjectName() {
  return execSync(`git remote get-url origin | cut -d '/' -f 5 | cut -d '.' -f 1`, { encoding: "utf-8" }).trim();
}

module.exports = { generateAndSaveMarkdown };
