const fs = require("fs");
const path = require("path");
const solc = require("solc");

function findImports(importPath) {
  try {
    const fullPath = path.resolve("node_modules", importPath);
    return { contents: fs.readFileSync(fullPath, "utf8") };
  } catch (e) {
    return { error: "File not found: " + importPath };
  }
}

const files = ["Election.sol", "ElectionFactory.sol"];
const sources = {};
for (const f of files) {
  sources[f] = { content: fs.readFileSync(path.join("contracts", f), "utf8") };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    optimizer: { enabled: true, runs: 200 },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

let hadError = false;
if (output.errors) {
  for (const err of output.errors) {
    console.log(err.severity.toUpperCase() + ": " + err.formattedMessage);
    if (err.severity === "error") hadError = true;
  }
}

if (!hadError) {
  console.log("\n✅ Compilation succeeded, no errors.\n");
  for (const file of Object.keys(output.contracts)) {
    for (const contractName of Object.keys(output.contracts[file])) {
      const bytecodeLen = output.contracts[file][contractName].evm.bytecode.object.length / 2;
      console.log(`  ${contractName}: ${bytecodeLen} bytes bytecode`);
    }
  }
} else {
  process.exit(1);
}
