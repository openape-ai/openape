export const inventoryProfile = String.raw`
import json, os, subprocess, datetime, glob

def command(argv):
    try:
        result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=8, env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'})
        if len(result.stdout) > 16384:
            return {'error':'output_limit'}
        return {'exitCode':result.returncode, 'value':result.stdout.decode('utf-8', errors='replace').strip()}
    except subprocess.TimeoutExpired:
        return {'error':'timeout'}
    except OSError:
        return {'error':'unavailable'}

def read(path):
    try:
        with open(path) as source:
            value = source.read(4097)
        return {'value':value.strip()} if len(value) <= 4096 else {'error':'output_limit'}
    except OSError:
        return {'error':'unavailable'}

facts = {
    'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'os':read('/etc/os-release'),
    'kernel':command(['/usr/bin/uname','-r']),
    'rebootRequired':os.path.exists('/var/run/reboot-required'),
    'packages':command(['/usr/bin/dpkg-query','-W','-f=' + '$' + '{db:Status-Status} ' + '$' + '{Package} ' + '$' + '{Version}\\n','linux-image-*','nodejs','nginx','openssl']),
    'candidates':command(['/usr/bin/apt-cache','policy','linux-image-cloud-amd64','nodejs','nginx','openssl']),
    'packageRefresh':command(['/usr/bin/systemctl','show','apt-daily.service','--property=Result','--property=ExecMainExitTimestamp','--property=ExecMainStatus']),
    'disk':command(['/bin/df','-P','/']),
    'services':command(['/usr/bin/systemctl','show','nginx.service','pm2-LPortalService.service','pm2-linde.service','--property=Id','--property=LoadState','--property=ActiveState','--property=SubState']),
    'backup':read('/home/debian/linde-s3-backup/last-run.txt'),
    'certificates':[],
    'authHealth':[]
}
for certificate in sorted(glob.glob('/etc/letsencrypt/live/*/cert.pem'))[:16]:
    facts['certificates'].append({'name':certificate.split('/')[-2], 'result':command(['/usr/bin/openssl','x509','-in',certificate,'-noout','-dates','-fingerprint','-sha256'])})
if os.path.isdir('/home/linde/lindesso_prod'):
    for port in [3000,3001]:
        facts['authHealth'].append({'port':port,'result':command(['/usr/bin/curl','--silent','--show-error','--noproxy','*','--max-time','5','--max-filesize','4096','--write-out','\\nHTTP %{http_code}','http://127.0.0.1:'+str(port)+'/api/health'])})
print(json.dumps({'version':1,'profile':'linde-server-v1','facts':facts}))
`

export function inventoryCommand(): string {
  return `sudo -n /usr/bin/python3 -c '${inventoryProfile.replaceAll('\'', '\'\\\'\'')}'`
}
export function parseInventoryOutput(stdout: string): Record<string, unknown> {
  const result = JSON.parse(stdout)
  const fields = ['observedAt', 'os', 'kernel', 'rebootRequired', 'packages', 'candidates', 'packageRefresh', 'disk', 'services', 'backup', 'certificates', 'authHealth']
  if (!result || result.version !== 1 || result.profile !== 'linde-server-v1' || Object.keys(result).some(key => !['version', 'profile', 'facts'].includes(key)) || !result.facts || Object.keys(result.facts).length !== fields.length || Object.keys(result.facts).some(key => !fields.includes(key)) || typeof result.facts.observedAt !== 'string' || !Number.isFinite(Date.parse(result.facts.observedAt)) || typeof result.facts.rebootRequired !== 'boolean') throw new Error('Malformed SSH inventory response')
  for (const field of ['os', 'kernel', 'packages', 'candidates', 'packageRefresh', 'disk', 'services', 'backup']) observation(result.facts[field])
  if (!Array.isArray(result.facts.certificates) || result.facts.certificates.length > 16 || !Array.isArray(result.facts.authHealth) || result.facts.authHealth.length > 2) throw new Error('Malformed SSH inventory lists')
  for (const item of result.facts.certificates) {
    if (!item || Object.keys(item).some(key => !['name', 'result'].includes(key)) || typeof item.name !== 'string' || !/^[\w.-]{1,255}$/.test(item.name)) throw new Error('Malformed certificate observation')
    observation(item.result)
  }
  for (const item of result.facts.authHealth) {
    if (!item || Object.keys(item).some(key => !['port', 'result'].includes(key)) || ![3000, 3001].includes(item.port)) throw new Error('Malformed health observation')
    observation(item.result)
  }
  return result
}
function observation(value: unknown): void {
  const item = value as { value?: string, exitCode?: number, error?: string }
  if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['value', 'exitCode', 'error'].includes(key)) || (item.error !== undefined ? !['timeout', 'unavailable', 'output_limit'].includes(item.error) || Object.keys(item).length !== 1 : typeof item.value !== 'string' || item.value.length > 16384 || (item.exitCode !== undefined && !Number.isInteger(item.exitCode)))) throw new Error('Malformed SSH observation')
}
