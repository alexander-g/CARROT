import {
    wasm_postprocessing_initialize,
    CARROT_Postprocessing,
} from "../deps-worker.ts";


type ImageSize = {width:number, height:number};

export type WorkerResizeMaskCommand = {
    command: 'resize_mask';
    
    /** Binary mask encoded as png.
        NOTE: uint8 instead of File, bc doesnt work (in deno) */
    maskdata_png: Uint8Array<ArrayBuffer>;

    /** Size to open the mask at. (Internal logic). */
    work_size: ImageSize

    /** Target size */
    target_size: ImageSize;
}

export type WorkerAbortResizeMaskCommand = {
    command: 'abort_resize_mask';
}

/** For unit tests */
export type SimulateErrorCommand = {
    command: '__simulate-error'
}

type WorkerCommand = 
    WorkerResizeMaskCommand
    | WorkerAbortResizeMaskCommand
    | SimulateErrorCommand;




type WorkerResizeMaskResult = {
    type: 'resize-mask-result';

    /** Binary mask encoded as png.
        NOTE: uint8 instead of File, bc doesnt work (in deno) */
    outputdata_png: Uint8Array<ArrayBuffer>;
}

type WorkerResult = WorkerResizeMaskResult | Error;
export type WorkerMessage = WorkerResult;



let __module:CARROT_Postprocessing|undefined;
async function get_module():Promise<CARROT_Postprocessing> {
    if(__module)
        return __module
    //else
    return await wasm_postprocessing_initialize()
}




async function resize_mask(
    command:WorkerResizeMaskCommand
): Promise<WorkerResizeMaskResult|Error> {
    const t0:number = performance.now()
    const module:CARROT_Postprocessing = await get_module();
 
    const maskfile = new File([command.maskdata_png], 'mask.png')
    const outputfile:File|Error = await module.resize_mask(
        maskfile, 
        command.work_size, 
        command.target_size
    );

    if(outputfile instanceof Error)
        return outputfile as Error;
    const outputdata: Uint8Array<ArrayBuffer> 
        = new Uint8Array(await outputfile.arrayBuffer())
    
    const t1:number = performance.now()
    console.log(`Worker ${self.name} resize_mask(): ${t1-t0}`)

    return {
        type: 'resize-mask-result',
        outputdata_png: outputdata,
    }
}

async function abort_resize_mask(): Promise<Error> {
    return await new Error('Aborted')
}


// main entry point
self.onmessage = async (e:MessageEvent) => {
    const data:WorkerCommand = e.data;
    console.log(`Worker ${self.name} onmessage: ${data.command}`)

    let result:WorkerResult;
    if(data.command == 'resize_mask')
        result = await resize_mask(data);
    else if(data.command == 'abort_resize_mask')
        result = await abort_resize_mask()
    else if(data.command == '__simulate-error') 
        throw new Error('This should not be used in production')
    else
        // deno-lint-ignore no-explicit-any
        result = new Error(`Unimplemented command: ${(data as any).command}`)

    self.postMessage(result);
    console.log(`Worker ${self.name} exit`)
    self.close();
}



self.addEventListener('error', (e:ErrorEvent) => {
    e.preventDefault();
    const msg:string = 
        `Worker ${self.name} error: ${e.message} (${e.filename}:${e.lineno})-${e.colno})`
    console.error(msg)
    self.postMessage(new Error(msg));
    self.close();
});


self.onunhandledrejection = (e:PromiseRejectionEvent) => {
    e.preventDefault()
    const msg:string = `Worker ${self.name} unhandled rejection: ${e.reason}`
    console.error(msg)
    self.postMessage(new Error(msg))
    self.close()
}

