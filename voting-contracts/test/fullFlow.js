const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { ethers } = require("ethers");
const ganache = require("ganache");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

function findImports(importPath) {
  const fullPath = path.resolve("node_modules", importPath);
  return { contents: fs.readFileSync(fullPath, "utf8") };
}

function compile() {
  const files = ["Election.sol", "ElectionFactory.sol"];
  const sources = {};
  for (const f of files) {
    sources[f] = { content: fs.readFileSync(path.join("contracts", f), "utf8") };
  }
  const input = {
    language: "Solidity",
    sources,
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const get = (file, name) => ({
    abi: output.contracts[file][name].abi,
    bytecode: "0x" + output.contracts[file][name].evm.bytecode.object,
  });
  return {
    Election: get("Election.sol", "Election"),
    ElectionFactory: get("ElectionFactory.sol", "ElectionFactory"),
  };
}

async function main() {
  const { Election, ElectionFactory } = compile();

  const server = ganache.provider({ logging: { quiet: true } });
  const provider = new ethers.BrowserProvider(server);
  const accounts = await provider.send("eth_accounts", []);
  const ownerSigner = await provider.getSigner(accounts[0]);
  const electionAdminSigner = await provider.getSigner(accounts[1]);

  console.log("Deploying ElectionFactory...");
  const factoryFactory = new ethers.ContractFactory(ElectionFactory.abi, ElectionFactory.bytecode, ownerSigner);
  const factory = await factoryFactory.deploy();
  await factory.waitForDeployment();
  console.log("  Factory deployed at:", await factory.getAddress());

  // --- Off-chain setup: generate a secret per eligible voter, build Merkle tree ---
  const voterSecrets = ["secret-alice", "secret-bob", "secret-carol", "secret-dave"];
  const leaves = voterSecrets.map((s) => keccak256(s));
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const merkleRoot = "0x" + tree.getRoot().toString("hex");
  console.log("  Merkle root of eligible voters:", merkleRoot);

  const now = Math.floor(Date.now() / 1000);
  const startTime = now - 10; // already open
  const endTime = now + 3600; // open for 1 hour

  console.log("\nCreating election via factory (domain=COLLEGE)...");
  const tx = await factory.createElection(
    accounts[1],
    "SRM Student Council Election 2026",
    "COLLEGE",
    ["Priya Sharma", "Rahul Verma", "Ananya Iyer"],
    startTime,
    endTime,
    merkleRoot
  );
  const receipt = await tx.wait();
  const createdEvent = receipt.logs
    .map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } })
    .find((l) => l && l.name === "ElectionCreated");
  const electionAddress = createdEvent.args.electionAddress;
  console.log("  Election deployed at:", electionAddress);

  const election = new ethers.Contract(electionAddress, Election.abi, ownerSigner);

  // --- Voter 1 (Alice) casts a valid vote for candidate 1 (Rahul Verma) ---
  console.log("\n[TEST 1] Alice casts a valid vote...");
  const aliceLeaf = keccak256(voterSecrets[0]);
  const aliceProof = tree.getProof(aliceLeaf).map((p) => "0x" + p.data.toString("hex"));
  const aliceNullifier = "0x" + aliceLeaf.toString("hex");

  const voteTx = await election.castVote(1, aliceNullifier, aliceProof);
  await voteTx.wait();
  console.log("  ✅ Vote accepted. Tx hash (audit receipt):", voteTx.hash);

  // --- TEST 2: Alice tries to vote again with the same nullifier -> must fail ---
  console.log("\n[TEST 2] Alice attempts to double-vote...");
  try {
    await election.castVote(0, aliceNullifier, aliceProof);
    console.log("  ❌ FAILED: double vote was accepted (this should not happen)");
  } catch (err) {
    console.log("  ✅ Correctly rejected:", err.shortMessage || err.reason || err.message.split("\n")[0]);
  }

  // --- TEST 3: A fake / unregistered voter tries to vote -> must fail ---
  console.log("\n[TEST 3] Unregistered fake voter attempts to vote...");
  const fakeLeaf = keccak256("i-am-not-registered");
  const fakeNullifier = "0x" + fakeLeaf.toString("hex");
  try {
    await election.castVote(0, fakeNullifier, aliceProof); // reusing a proof that won't match
    console.log("  ❌ FAILED: fake voter was accepted (this should not happen)");
  } catch (err) {
    console.log("  ✅ Correctly rejected:", err.shortMessage || err.reason || err.message.split("\n")[0]);
  }

  // --- Bob and Carol cast legitimate votes too ---
  console.log("\n[TEST 4] Bob and Carol cast valid votes...");
  for (const [i, name] of [[1, "Bob"], [2, "Carol"]]) {
    const leaf = keccak256(voterSecrets[i]);
    const proof = tree.getProof(leaf).map((p) => "0x" + p.data.toString("hex"));
    const nullifier = "0x" + leaf.toString("hex");
    const t = await election.castVote(0, nullifier, proof); // both vote for candidate 0
    await t.wait();
    console.log(`  ✅ ${name}'s vote accepted.`);
  }

  // --- Finalize after end time (fast-forward chain time) ---
  console.log("\n[TEST 5] Fast-forwarding past end time and finalizing...");
  await provider.send("evm_increaseTime", [3700]);
  await provider.send("evm_mine", []);
  const finalizeTx = await election.connect(electionAdminSigner).finalizeElection();
  await finalizeTx.wait();
  console.log("  ✅ Election finalized.");

  const results = await election.getResults();
  console.log("\n=== FINAL RESULTS (publicly auditable) ===");
  results.forEach((c) => console.log(`  ${c.name}: ${c.voteCount} vote(s)`));
  console.log("Total votes cast:", (await election.totalVotesCast()).toString());

  await server.disconnect();
  console.log("\nAll checks completed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
