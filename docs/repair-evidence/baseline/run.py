import datetime,json,os,pathlib,subprocess,sys,time
label=sys.argv[1]; command=sys.argv[2:]
base=pathlib.Path(__file__).resolve().parent
start=datetime.datetime.now(datetime.timezone.utc); tick=time.monotonic()
env=os.environ.copy(); env['DATABASE_URL']='file:./dev.db'; env['NEXT_TELEMETRY_DISABLED']='1'
with (base/(label+'.log')).open('w') as out:
 result=subprocess.run(command,stdout=out,stderr=subprocess.STDOUT,env=env)
record={'label':label,'command':command,'cwd':os.getcwd(),'start_utc':start.isoformat(),'finish_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsed_seconds':round(time.monotonic()-tick,3),'exit_code':result.returncode}
with (base/'commands.jsonl').open('a') as out: out.write(json.dumps(record)+'\n')
print(json.dumps(record)); print((base/(label+'.log')).read_text()[-6000:])
