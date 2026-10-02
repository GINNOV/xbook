const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");

function compileMaintenance(source, destination) {
  const compiled = ts.transpileModule(fs.readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    reportDiagnostics: true,
  });
  const errors = compiled.diagnostics?.filter((entry) => entry.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: (name) => name, getNewLine: () => "\n" }));
  fs.writeFileSync(destination, compiled.outputText);
}

function validateNodeBinary(candidate, repositoryDirectory) {
  const binary = fs.realpathSync(candidate);
  fs.accessSync(binary, fs.constants.X_OK);
  const sqliteModule = require.resolve("better-sqlite3", { paths: [repositoryDirectory] });
  const probe = `const Database=require(${JSON.stringify(sqliteModule)}); const db=new Database(':memory:'); db.prepare('SELECT 1').get(); db.close(); process.stdout.write(JSON.stringify({abi:process.versions.modules,platform:process.platform,arch:process.arch}));`;
  const result = JSON.parse(execFileSync(binary, ["-e", probe], { encoding: "utf8" }));
  if (result.abi !== process.versions.modules || result.platform !== process.platform || result.arch !== process.arch) {
    throw new Error("Desktop Node binary must match the build runtime native ABI, platform and architecture.");
  }
  return binary;
}

module.exports = { compileMaintenance, validateNodeBinary };
