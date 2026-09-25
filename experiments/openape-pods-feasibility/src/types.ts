export interface BoundaryPaths {
  workspace: string
  snapshot: string
  child: string
  node: string
  native: string
  allowedPort: number
}

export interface Probe {
  id: string
  operation: string
  args: string[]
  expected: 'allow' | 'deny'
}

export interface Observation {
  id: string
  expected: 'allow' | 'deny'
  status: 'PASS' | 'FAIL' | 'UNVERIFIED'
  controlExit: number | null
  sandboxExit: number | null
  sandboxSignal: string | null
  stdout: string
  stderr: string
}
