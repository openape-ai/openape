import { createProblemError } from './problem'

export async function brokerInput<T>(parse: () => T | Promise<T>, status: 400 | 401 = 400): Promise<T> {
  try { return await parse() }
  catch { throw createProblemError({ status, title: status === 401 ? 'Invalid broker signature' : 'Invalid broker input', type: 'https://openape.org/errors/broker_request_invalid' }) }
}
