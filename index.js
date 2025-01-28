const { readFileSync, existsSync } = require("fs");
const path = require("path");
const { extractAndSaveJson } = require("./extractor.js");
const { generateAndSaveMarkdown } = require("./generateMarkdown.js");
/**
 * @description Extracts contract deployment data from run-latest.json (foundry broadcast output) and writes to deployments/json/{chainId}.json & deployments/{chainId}.md
 * @usage node index.js {chainId} [scriptName = "Deploy.s.sol"] [--skip-json | -s]
 * @dev
 *  currently only supports TransparentUpgradeableProxy pattern
 *  foundry (https://getfoundry.sh) required
 */
async function main() {
  let [chainId, scriptName, skipJsonFlag, rpcUrl, explorerUrl, force, broadcastDir, outDir] =
    validateAndExtractInputs();
  let json;
  if (!skipJsonFlag) json = await extractAndSaveJson(scriptName, chainId, rpcUrl, force, broadcastDir, outDir);
  else {
    console.log("Skipping json extraction, using existing json file");
    const recordFilePath = path.join(__dirname, `../../deployments/json/${chainId}.json`);
    if (!existsSync(recordFilePath)) throw new Error(`error: ${recordFilePath} does not exist`);
    json = JSON.parse(readFileSync(recordFilePath, "utf-8"));
  }
  if (json !== undefined) generateAndSaveMarkdown(json, explorerUrl);
}

function validateAndExtractInputs() {
  const scriptName = process.argv[2];

  if (scriptName === "-h" || scriptName === "--help") {
    printHelp();
    process.exit(0);
  } else if (scriptName === "-v" || scriptName === "--version") {
    console.log(JSON.parse(readFileSync("lib/forge-chronicles/package.json", "utf8")).version);
    process.exit(0);
  }

  const args = process.argv.slice(scriptName.startsWith("-") ? 2 : 3);
  let forceFlag = false;
  let skipJsonFlag = false;
  let chainId = 31337;
  let rpcUrl;
  let explorerUrl = undefined;
  let broadcastDir = "broadcast";
  let outDir = "out";
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--force":
      case "-f":
        forceFlag = true;
        break;
      case "--skip-json":
      case "-s":
        skipJsonFlag = true;
        break;
      case "-c":
      case "--chain-id":
        // Check if there's another argument after --chain-id and the argument is not another command
        if (i + 1 < args.length && args[i + 1].charAt(0) !== "-") {
          chainId = args[i + 1];
          i++; // Skip the next argument
          break;
        } else {
          console.error("Error: --chain-id flag requires the chain id of the network where the script was executed");
          process.exit(1);
        }
      case "-r":
      case "--rpc-url":
        // Check if there's another argument after --rpc-url and the argument is not another command
        if (i + 1 < args.length && args[i + 1].charAt(0) !== "-") {
          rpcUrl = args[i + 1];
          i++; // Skip the next argument
          break;
        } else {
          console.error("Error: --rpc-url flag requires an rpc url");
          process.exit(1);
        }
      case "-e":
      case "--explorer-url":
        // Check if there's another argument after --explorer-url and the argument is not another command
        if (i + 1 < args.length && args[i + 1].charAt(0) !== "-") {
          explorerUrl = args[i + 1];
          i++; // Skip the next argument
          break;
        } else {
          console.error("Error: --explorer-url flag requires an explorer url");
          process.exit(1);
        }
      case "-b":
      case "--broadcast-dir":
        // Check if there's another argument after --broadcast-dir and the argument is not another command
        if (i + 1 < args.length && args[i + 1].charAt(0) !== "-") {
          broadcastDir = args[i + 1];
          i++; // Skip the next argument
          break;
        } else {
          console.error("Error: --broadcast-dir flag requires a directory path");
          process.exit(1);
        }
      case "-o":
      case "--out-dir":
        // Check if there's another argument after --output-dir and the argument is not another command
        if (i + 1 < args.length && args[i + 1].charAt(0) !== "-") {
          outDir = args[i + 1];
          i++; // Skip the next argument
          break;
        } else {
          console.error("Error: --out-dir flag requires a directory path");
          process.exit(1);
        }
      default:
        printHelp();
        process.exit(1);
    }
  }

  if (scriptName.startsWith("-") && !skipJsonFlag) {
    console.error("Error: scriptName is required unless --skip-json flag is used");
    printHelp();
    process.exit(1);
  }

  return [chainId, scriptName, skipJsonFlag, rpcUrl, explorerUrl, forceFlag, broadcastDir, outDir];
}

const printHelp = () => {
  console.log(
    "\nUsage: node lib/forge-chronicles <scriptName> [-c chain-id] [-r rpc-url] [-e explorer-url] [-s skip-json] [-b broadcast-dir] [-o out-dir]\n\nCommands:\n  -c, --chain-id\tChain id of the network where the script was executed (default: 31337)\n  -r, --rpc-url\t\tRPC url used to fetch the version of the contract or verify an upgrade. If no rpc url is provided, version fetching is skipped.\n  -e, --explorer-url\tExplorer url to use for links in markdown, If no url is provided, blockscan is used by default.\n  -s, --skip-json\tSkips the json generation and creates the markdown file using an existing json file\n  -b, --broadcast-dir\tDirectory where the broadcast files are stored (default: broadcast)\n  -o, --out-dir\t\tDirectory where the foundry output files are stored (default: out)\n  -f, --force\t\tForce the generation of the json file with the same commit\n\nOptions:\n  -h, --help\t\tPrint help\n  -v, --version\t\tPrint version\n\nDocumentation can be found at https://github.com/0xPolygon/forge-chronicles",
  );
};

main();
