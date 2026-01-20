import {
    wasm_postprocessing_initialize,
    CARROT_Postprocessing,
} from "../deps-worker.ts";


type ImageSize = {width:number, height:number};

// TODO: remove
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

// TODO: rename
export type WorkerAbortCommand = {
    command: 'abort';
}

export type WorkerRasterizeMaskCommand = {
    command: 'rasterize_mask';

    /** Cells to rasterize, in RLE format as returned by postprocessing function */
    cells_serialized: ArrayBuffer;

    /** Target size */
    target_size: ImageSize;
}

/** For unit tests */
export type SimulateErrorCommand = {
    command: '__simulate-error'
}

export type WorkerCommand = 
    WorkerResizeMaskCommand
    | WorkerRasterizeMaskCommand
    | WorkerAbortCommand
    | SimulateErrorCommand;




type WorkerRasterizeMaskResult = {
    type: 'rasterize-mask-result';

    /** Binary mask encoded as png.
        NOTE: uint8 instead of File, bc doesnt work (in deno) */
    outputdata_png: Uint8Array<ArrayBuffer>;
}
type WorkerResizeMaskResult = Omit<WorkerRasterizeMaskResult, 'type'> & {
    type: 'resize-mask-result'
};

type WorkerResult = WorkerRasterizeMaskResult | WorkerResizeMaskResult | Error;
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


async function rasterize_mask(
    command: WorkerRasterizeMaskCommand
): Promise<WorkerRasterizeMaskResult|Error> {
    const t0:number = performance.now()
    const module:CARROT_Postprocessing = await get_module();
 
    const outputfile:File|Error = 
        await module.rasterize_cell_indices_and_encode_as_png(
            command.cells_serialized, 
            command.target_size
        );

    if(outputfile instanceof Error)
        return outputfile as Error;
    const outputdata: Uint8Array<ArrayBuffer> 
        = new Uint8Array(await outputfile.arrayBuffer())
    
    const t1:number = performance.now()
    console.log(`Worker ${self.name} rasterize_mask(): ${t1-t0}`)

    return {
        type: 'rasterize-mask-result',
        outputdata_png: outputdata,
    }
}

async function abort(): Promise<Error> {
    return await new Error('Aborted')
}


// main entry point
self.onmessage = async (e:MessageEvent) => {
    const data:WorkerCommand = e.data;
    console.log(`Worker ${self.name} onmessage: ${data.command}`)

    let result:WorkerResult;
    if(data.command == 'resize_mask')
        result = await resize_mask(data);
    else if(data.command == 'rasterize_mask') 
        result = await rasterize_mask(data);
    else if(data.command == 'abort')
        result = await abort()
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

