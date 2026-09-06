// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Command } = require('commander')

const program = new Command()

program.name('flyai')
program
  .command('search-flight')
  .requiredOption('--origin <CITY>')
  .requiredOption('--destination <CITY>')
  .requiredOption('--dep-date <YYYY-MM-DD>')
  .action((options) => {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        origin: options.origin,
        destination: options.destination,
        depDate: options.depDate,
        argv: process.argv
      })}\n`,
      () => process.exit(0)
    )
  })

program.parse()
