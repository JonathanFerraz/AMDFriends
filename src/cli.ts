#!/usr/bin/env node
import { cpus } from "os";
import { resolve } from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { patchFile } from ".";
import { parallelizer } from "./parallelizer";
import { PatchOptions } from "./types";
import { walkDirectory } from "./utils";

// Argument definiiton and parsing
const argv = yargs(hideBin(process.argv))
  .scriptName("friendlyamd")
  .usage("$0 [args] <path/to/library> [.../path/to/other/libraries]")
  .option("in-place", {
    alias: "i",
    describe:
      "Directly patch the library, as opposed to creating a patched library with `.patched` appended to the file name.",
    demandOption: false,
    type: "boolean",
    default: false,
  })
  .option("dry-run", {
    alias: "d",
    describe:
      "Do all checking and patching, but DO NOT write anything to disk.",
    demandOption: false,
    type: "boolean",
    default: false,
  })
  .option("backup", {
    alias: "b",
    describe:
      "Only works in conjunction with `--in-place`; it backs up the original library by copying it and appending `.bak` on its extension.",
    demandOption: false,
    type: "boolean",
    default: false,
    implies: "in-place",
  })
  .option("sign", {
    alias: "s",
    describe: "Automatically invoke `codesign` on patched libraries.",
    demandOption: false,
    type: "boolean",
    default: false,
  })
  .option("clear-xa", {
    alias: "c",
    describe: "Automatically clear extended attributes on patched libraries.",
    demandOption: false,
    type: "boolean",
    default: true,
  })
  .option("directories", {
    alias: "D",
    describe:
      "Scan directories alongside files. It will search for any file with no extension and with extension `.dylib`, as they are the common ones to patch.",
    demandOption: false,
    type: "array",
    default: [],
  })
  .option("jobs", {
    alias: "j",
    describe:
      "The number of jobs that will be spawned to process the libraries.",
    demandOption: false,
    type: "number",
    default: cpus().length,
  })
  .help().argv as { $0: string; _: (string | number)[]; [x: string]: any };

// CLI CODE
async function patchPromise(
  originalFilePath: string,
  options: PatchOptions,
): Promise<void> {
  console.log(`Analyzing and patching file: ${originalFilePath}`);
  const p = await patchFile(originalFilePath, options);

  if (p) {
    console.log(`Routines found for ${originalFilePath}:`);
    console.log(
      p.patchedRoutines
        .map(
          (x) =>
            `- <${x.bytes
              .toString("hex")
              .toUpperCase()
              .match(/.{1,2}/g)!
              .join(
                " ",
              )}> at offset ${x.offset} (Hex: ${x.offset.toString(16)})`,
        )
        .join("\n"),
    );

    console.log(`File ${originalFilePath} was patched.`);
    console.log(`Patched file location: ${p.patchedPath}`);
  }

  console.log(`Finished processing file: ${originalFilePath}`);
}

function* promiseGen(): Generator<Promise<void>> {
  if (argv.directories) {
    for (const dirPath of argv.directories) {
      for (const dirent of walkDirectory(
        dirPath,
        ["", ".dylib"],
        [".DS_Store"],
      )) {
        const originalFilePath = resolve(dirent.name);
        yield patchPromise(originalFilePath, {
          dryRun: argv["dry-run"],
          inPlace: argv["in-place"],
          backup: argv.backup,
          clearXA: argv["clear-xa"],
          sign: argv.sign,
        });
      }
    }
  }
  for (const path of argv._) {
    const originalFilePath = resolve(path.toString());
    yield patchPromise(originalFilePath, {
      dryRun: argv["dry-run"],
      inPlace: argv["in-place"],
      backup: argv.backup,
      clearXA: argv["clear-xa"],
      sign: argv.sign,
    });
  }
}

(async () => {
  if (!argv._.length && !argv.directories.length) {
    console.error("You must specify at least a path to a library as argument!");
    process.exit(1);
  }

  if (argv.jobs <= 0) {
    console.error(
      "The number of jobs to spawn must be a positive integer greater than zero!",
    );
    process.exit(1);
  }

  if (argv["dry-run"]) {
    console.log(
      "\n\nWarning!\nDry run is active! No files will be actually patched!\n",
    );
  }

  await parallelizer(promiseGen(), argv.jobs);
})();
