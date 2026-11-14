import ArgumentParser

@main
struct SophonCLI: AsyncParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "sophon-cli",
    abstract: "A Sophon command line utility",
    subcommands: [
      HYPAPIClientEntrypoint.self, InstallCLI.self, UpdateCLI.self, NextActionCLI.self,
      UpdateStateCLI.self, RPCCLI.self,
    ],
  )
}
