process.stderr.write("START\n");
process.stdin.on("data", () => {});
process.stdin.on("end", () => { process.stderr.write("END\n"); process.exit(0); });
