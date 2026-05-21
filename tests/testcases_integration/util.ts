// deno-lint-ignore-file no-empty


import { wait } from "../../base/tests/testcases_deno/util.ts";
export { wait };


const DEFAULT_CMD: string[] = ['python', '-u', 'main.py']
const CMD: string[] = resolve_cmd(
    Deno.env.get('CMD'),
    DEFAULT_CMD,
)

const IS_WINDOWS: boolean = (Deno.build.os === 'windows')


type SubprocessOptions = {
    cmd?: string[];
    cwd?: string;
    env?: Record<string, string>;
};

export async function run_backend_as_subprocess(
    fn:    (p: Deno.ChildProcess) => Promise<void> | void,
    opts?: SubprocessOptions,
): Promise<void> {
    const cmd: string[] = opts?.cmd ?? CMD

    const p: Deno.ChildProcess =
        new Deno.Command(
            cmd[0]!,
            {
                args: cmd.slice(1),
                cwd: opts?.cwd,
                env: opts?.env ?? {'LD_LIBRARY_PATH': ''},
                stdin: 'null',
                stdout: 'inherit',
                stderr: 'inherit',
            },
        ).spawn()

    try {
        await fn(p)
    } finally {
        await terminate(p)
    }
}

async function terminate(p: Deno.ChildProcess): Promise<void> {
    const timeout_handle: number = setTimeout(
        () => {
            void kill_process_forcefully(p)
        },
        3000,
    )

    try {
        if (IS_WINDOWS)
            await kill_process_tree(p.pid)
        else
            p.kill('SIGTERM')

        await p.status
    } catch {
        await kill_process_forcefully(p)
    } finally {
        clearTimeout(timeout_handle)
    }
}

function resolve_cmd(
    value:       string | undefined,
    default_cmd: string[],
): string[] {
    if (!value)
        return default_cmd

    const parsed_cmd: string[] = split_command_line(value)

    if (parsed_cmd.length === 0)
        return default_cmd

    return parsed_cmd
}

/** Parse a command line into arguments. */
function split_command_line(value: string): string[] {
    const args: string[] = []
    let current: string = ''
    let in_quotes: boolean = false

    for (const ch of value) {
        if (ch === '"') {
            in_quotes = !in_quotes
            continue
        }

        if (ch === ' ' && !in_quotes) {
            if (current.length > 0) {
                args.push(current)
                current = ''
            }
            continue
        }

        current += ch
    }

    if (current.length > 0)
        args.push(current)

    return args
}

/** Terminate a process tree on Windows. */
async function kill_process_tree(pid: number): Promise<Error | null> {
    try {
        const process: Deno.ChildProcess = new Deno.Command(
            'taskkill',
            {
                args: ['/PID', String(pid), '/T', '/F'],
                stdout: 'null',
                stderr: 'null',
            },
        ).spawn()

        await process.status
        return null
    } catch (error) {
        console.log(error)
        if (error instanceof Error)
            return error

        return new Error('taskkill failed')
    }
}

async function kill_process_forcefully(
    p: Deno.ChildProcess,
): Promise<Error | null> {
    if (IS_WINDOWS)
        return await kill_process_tree(p.pid)

    try {
        p.kill('SIGKILL')
        return null
    } catch (error) {
        if (error instanceof Error)
            return error

        return new Error('SIGKILL failed')
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
