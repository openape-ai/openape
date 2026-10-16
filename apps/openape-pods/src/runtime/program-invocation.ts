import { bindProgramCall, locateProgram } from '@openape/apes/program'

/** Resolve the executable and code exactly as ape-shell does, without executing the call. */
export async function programInvocation(executable: string, sha256: string, argv: string[], files: { path: string, sha256: string }[], cwd: string, environment: Record<string, string>) {
  const program = await locateProgram(executable)
  if (!program || program.sha256 !== sha256) throw new Error('Assigned executable changed before authorization')
  const call = bindProgramCall({ program, argv, files }, { cwd, env: environment })
  return { program: { name: program.name, sha256: program.sha256 }, argv: call.argv, files: call.files }
}
