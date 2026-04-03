import { describe, expect, it } from 'vitest'
import { CliError, CliExit } from '../src/errors'

describe('CliError', () => {
  it('has correct name and message', () => {
    const err = new CliError('test error')
    expect(err.name).toBe('CliError')
    expect(err.message).toBe('test error')
    expect(err.exitCode).toBe(1)
  })

  it('supports custom exit code', () => {
    const err = new CliError('exit 2', 2)
    expect(err.exitCode).toBe(2)
  })

  it('is an instance of Error', () => {
    const err = new CliError('test')
    expect(err).toBeInstanceOf(Error)
  })
})

describe('CliExit', () => {
  it('has correct name and default exit code', () => {
    const err = new CliExit()
    expect(err.name).toBe('CliExit')
    expect(err.exitCode).toBe(0)
    expect(err.message).toBe('')
  })

  it('supports custom exit code', () => {
    const err = new CliExit(42)
    expect(err.exitCode).toBe(42)
  })

  it('is an instance of Error', () => {
    const err = new CliExit()
    expect(err).toBeInstanceOf(Error)
  })
})
