// deno-lint-ignore-file no-empty


import { wait } from "../../base/tests/testcases_deno/util.ts";
export { wait };


const DEFAULT_CMD: string[] = ["python", "-u", "main.py"];
const CMD: string[] = (Deno.env.get("CMD")?.split(" ")) ?? DEFAULT_CMD;

const IS_WINDOWS: boolean = (Deno.build.os === "windows");


type SubprocessOptions = {
    cmd?: string[];
    cwd?: string;
    env?: Record<string, string>;
};

export async function run_backend_as_subprocess(
    fn:    (p: Deno.ChildProcess) => Promise<void> | void,
    opts?: SubprocessOptions,
) {
    const cmd: string[] = opts?.cmd ?? CMD;

    const p: Deno.ChildProcess = 
        new Deno.Command(
            cmd[0]!, 
            {
                args: cmd.slice(1),
                cwd: opts?.cwd,
                env: opts?.env,
                stdin: "null",
                stdout: "inherit",
                stderr: "inherit",
            }
        ).spawn();

    try {
        await fn(p);
    } finally {
        await terminate(p);
    }
}

async function terminate(p: Deno.ChildProcess) {
    const timeout_handle:number = setTimeout(
        () => {
            try {
            p.kill("SIGKILL");
            } catch {}
        }, 
        3000
    );

    try {
        if (IS_WINDOWS)
            p.kill("SIGTERM");
        else
            p.kill("SIGTERM");
        
        await p.status;
    } catch {
        try {
            p.kill("SIGKILL");
        } catch {}
    } finally {
        clearTimeout(timeout_handle);
    }
}


export async function wait_until_port_available(
    host:     string,
    port:     number,
    timeout:  number = 30000,
    interval: number = 1000,
) {
    if( Deno.permissions.querySync({name:'net', host:host}).state != 'granted' )
        throw new Error(`No permissions to connect to ${host}`)

    const deadline: number = Date.now() + timeout;

    while (true) {
        try {
            const conn: Deno.TcpConn = await Deno.connect({ hostname: host, port });
            conn.close();
            return true;
        } catch (e) {
            if (Date.now() > deadline)
                throw new Error(`${host}:${port} not available after ${timeout}ms`);
        
            await wait(interval);
        }
    }
}


export async function file_upload(url: string, path: string) {
    const data: Uint8Array = await Deno.readFile(path);
    const boundary: string = crypto.randomUUID().replace(/-/g, "");
    const filename: string = path.split("/").pop() ?? "file";

    const encoder = new TextEncoder();
    const crlf = "\r\n";

    const part_header: string =
        `--${boundary}${crlf}` +
        `Content-Disposition: form-data; name="files"; filename="${filename}"${crlf}` +
        `Content-Type: application/octet-stream${crlf}${crlf}`;

    const closing = `${crlf}--${boundary}--${crlf}`;

    const body = new Uint8Array(
        encoder.encode(part_header).length +
        data.length +
        encoder.encode(closing).length,
    );

    let offset: number = 0;
    body.set(encoder.encode(part_header), offset);
    offset += encoder.encode(part_header).length;
    body.set(data, offset);
    offset += data.length;
    body.set(encoder.encode(closing), offset);

    const res: Response = await fetch(
        url, 
        {
            method: "POST",
            headers: {
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
                "Content-Length": String(body.length),
            },
            body,
        }
    );

    if(res.status !== 200)
        throw new Error(`Upload failed with status ${res.status}`);
}

