import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function runCore(python, coreDir, args, { signal, timeoutMs }) {
  const operation = execFileAsync(python, ['-m', 'dualloop', ...args], {
    cwd: coreDir,
    signal,
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  })
  const child = operation.child
  const closed = new Promise((resolve) => child.once('close', resolve))
  const forceExit = () => child.kill('SIGKILL')
  // execFile rejects on AbortError before close. A timeout can also leave a
  // SIGTERM-ignoring child alive. Bound the grace period and await quiescence.
  const deadline = timeoutMs > 0 ? setTimeout(forceExit, timeoutMs + 1000) : undefined
  try {
    return await operation
  } catch (error) {
    const escalation = setTimeout(forceExit, 1000)
    try {
      await closed
    } finally {
      clearTimeout(escalation)
    }
    // A structured domain error is a valid result, not a lost child traceback.
    // Process failures, cancellation and malformed output still fail loudly.
    if (error.code === 2 && error.stdout) {
      let value
      try {
        value = JSON.parse(error.stdout)
      } catch {
        throw error
      }
      if (value.api_version === 1 && value.error?.code) {
        return { stdout: error.stdout, stderr: error.stderr ?? '' }
      }
    }
    throw error
  } finally {
    clearTimeout(deadline)
  }
}
