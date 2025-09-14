import { base, Signal, signals, JSX, preact } from "../dep.ts"
import { CARROT_State, is_unfinished }  from "./state.ts"
import { 
    CARROT_Result, 
    CARROT_Data,
    CARROT_Backend,
    UnfinishedCARROT_Result,
    TreeringInfo,
    _zip_into_treerings
} from "../lib/carrot_detection.ts"
import { TreeringsSVGOverlay, PointPair } from "./TreeringsSVGOverlay.tsx"
import { CARROT_ModelTypes } from "../lib/carrot_settings.ts";
import * as onnx_sam from "../lib/onnx_sam.ts"


export 
class CARROT_DetectionTab extends base.detectiontab.DetectionTab<CARROT_State> {
    override resultclass() {
        return CARROT_Result;
    }

    override file_table_content() {
        return CARROT_Content;
    }
}



type DrawingMode = 'brush' | 'erase' | 'sam';
type Box = base.boxes.Box;


type GenericBackend = base.files.ProcessingModule<File, CARROT_Result>;


/** Global sam onnx session because only one model */
let sam_onnx_session:onnx_sam.ONNX_SamSession|undefined = undefined;

const HARDCODED_ENCODER_FILENAME = '2025-03-18_beech_cells_large.pt'
const HARDCODED_ENCODER_URL = `https://github.com/alexander-g/assets/releases/download/2025-04-03/${HARDCODED_ENCODER_FILENAME}`
const HARDCODED_ONNX_FILENAME = 'sam_decoder_vit_b.onnx'
const HARDCODED_ONNX_URL = `https://github.com/alexander-g/assets/releases/download/2025-04-03/${HARDCODED_ONNX_FILENAME}`



export 
class CARROT_Content extends base.SingleFileContent<CARROT_Result>{
    canvas_ref: preact.RefObject<EditCanvas> = preact.createRef()
    edit_menu_ref: preact.RefObject<EditMenu> = preact.createRef()
    sam_modal_ref: preact.RefObject<SAM_Modal> = preact.createRef()
    
    $active_editing_mode: Signal<CARROT_ModelTypes|null> = new Signal(null)
    $editing_brush_size:  Signal<number> = new Signal(0)
    
    /** Whether to draw, erase or use SAM */
    $drawing_mode: Signal<DrawingMode> = new Signal('brush')

    $treering_points: Readonly<Signal<PointPair[][]>> = signals.computed( () => { 
        return this.props.$result.value.get_treering_coordinates_if_loaded() ?? [] 
    })

    $overlays_visible:Readonly<Signal<boolean>> = signals.computed(() => {
        return this.$result_visible.value 
        && (this.$active_editing_mode.value == null)
    })

    $dim_input_image_when_editing: Readonly< Signal<JSX.CSSProperties> > = 
        signals.computed( () => {
            const edit_on:boolean = (this.$active_editing_mode.value != null)
            const result_processed:boolean = 
                this.props.$result.value.status == 'processed';
            const result_visible:boolean = this.$overlays_visible.value
            const should_dim:boolean = 
                edit_on || (result_processed && result_visible);
            return (should_dim) ? {filter:'brightness(0.7)'} : {};
        } )
    
    #_ = signals.effect( () => {
        if(this.$active_editing_mode.value != null) {
            document.addEventListener('keydown', this.handle_ctrl_z);
        } else {
            document.removeEventListener('keydown', this.handle_ctrl_z);
        }
    } )


    override result_overlays(): JSX.Element {
        return <>
            <base.imageoverlay.ImageOverlay 
                image     = { this.get_overlayimage() }
                $visible  = { this.$overlays_visible }
            />
            <TreeringsSVGOverlay 
                size = { this.$og_imagesize.value ?? {height:0, width:0} }
                $result = { this.props.$result }
                $scale  = { this.$scale }
                $visible = { this.$overlays_visible }
            />
            <EditCanvas 
                ref = {this.canvas_ref} 
                $active_modality = { this.$active_editing_mode }
                $drawing_mode = { this.$drawing_mode }
                $imagesize   = { this.$imagesize }
                $brush_size  = { this.$editing_brush_size }
                $inputblob   = { signals.computed(() => 
                    _get_map_for_editmode(
                        this.$active_editing_mode.value,
                        this.props.$result.value,
                    )
                ) }
                on_new_sam_box = { this.on_sam_new_box }
            />

            {/* <SAM_Modal ref={this.sam_modal_ref} /> */}
        </>
    }

    get_overlayimage(): File|null {
        const resultdata_:CARROT_Data = this.props.$result.value.data;
        if(is_unfinished(resultdata_))
            return null;
        
        // NOTE: re-declaring because typescript complains
        const resultdata:CARROT_Data = this.props.$result.value.data;

        // TODO: let user decide
        return ('colored_cellmap' in resultdata)? resultdata.colored_cellmap : 
               ('instancemap'     in resultdata)? resultdata.instancemap :
               ('cellmap'         in resultdata)? resultdata.cellmap :
               ('treeringmap'     in resultdata)? resultdata.treeringmap : 
               null;
    }


    // NOTE: adding <SAM_Modal /> in result_overlays() caused issues
    // TODO: does not belong here, should exist only once
    override render():JSX.Element {
        return <>
            { super.render(this.props) }
            <SAM_Modal ref={this.sam_modal_ref} />
        </>
    }

    // TODO: show cells / show treerings
    //override view_menu_items(): JSX.Element[] {}

    override content_menu_extras(): JSX.Element[] {
        return [
            <EditMenu 
                ref = {this.edit_menu_ref}
                on_apply = { this.on_apply_editing_changes }
                on_clear = { () => this.canvas_ref.current?.clear() }
                on_undo  = { () => this.canvas_ref.current?.undo() }
                on_reverse_growth_direction = {this.on_reverse_growth_direction}
                $active_modality = { this.$active_editing_mode }
                $drawing_mode = { this.$drawing_mode }
                $brush_size  = { this.$editing_brush_size }
                key = { 0 } // to make typescript happy
            />
        ]
    }

    // TODO: needs error messages to user
    on_apply_editing_changes: () => Promise<boolean> = async () => {
        const backend:GenericBackend|CARROT_Backend|null = 
            this.props.$processingmodule.value
        const mode:CARROT_ModelTypes|null = this.$active_editing_mode.value
        if(!(backend instanceof CARROT_Backend)
        || mode == null)
            return false;
        const blob:Blob|null = await this.canvas_ref.current!.to_blob()
        if(blob == null)
            return false;
        
        const current_data:CARROT_Data = this.props.$result.value.data;
        const filename = `${this.props.input.name}.${mode}.png`
        const edited_file = new File([blob], filename)
        const attribute:'cellmap'|'treeringmap'= 
            mode == 'cells'? 'cellmap' : 'treeringmap';

        const unfinished_result: UnfinishedCARROT_Result = {
            status:    'processing',
            inputname: this.props.input.name,
            data: {
                ...current_data,
                [attribute]:edited_file,
            }
        }
        // awkward
        this.props.$result.value = new CARROT_Result('processing');
        const edited_result:CARROT_Result = 
            await backend.postprocess_result(unfinished_result, this.props.input)

        // TODO: if not succesful then maybe shouldnt set $result.value ?
        this.props.$result.value = edited_result;
        return (edited_result.status == 'processed');
    }

    on_reverse_growth_direction = () => {
        this.props.$result.value = 
            CARROT_Result.reverse_growth_direction(this.props.$result.value)
    }

    override input_image_css(): 
    Readonly<signals.Signal<JSX.CSSProperties>> | undefined {
        return this.$dim_input_image_when_editing
    }

    handle_ctrl_z = (e:KeyboardEvent) => {
        if(e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            this.canvas_ref.current!.undo()
        }
    }




    #_prev_drawing_mode:DrawingMode = this.$drawing_mode.value;
    #_1 = this.$drawing_mode.subscribe( (mode:DrawingMode) => {
        // TODO: clear cursor when activating sam
        if(mode == 'sam')
            this.on_sam_activate(this.#_prev_drawing_mode)
        
        this.#_prev_drawing_mode = mode;
    } )
    


    #sam_embeddings?:Float32Array;
    #sam_orig_im_size?:base.util.ImageSize;

    // TODO:
    on_sam_activate = async (prev_mode:DrawingMode) => {
        const backend:GenericBackend|CARROT_Backend|null = 
            this.props.$processingmodule.value
        if(!(backend instanceof CARROT_Backend)){
            console.error('Processing backend is not a CARROT backend', backend)
            this.$drawing_mode.value = prev_mode;
            return;
        }
        
        if(sam_onnx_session != undefined
        && this.#sam_embeddings != undefined
        && this.#sam_orig_im_size != undefined)
            return;
        
        // TODO: check if sam is already available
        // TODO: check if image not too large, incl px/um
        //  - download SAM
        //  - download onnxruntime wasm
        const proceed:boolean = 
            await this.sam_modal_ref.current!.show_download_required()
        if(!proceed) {
            // user cancelled or something went wrong, back to previous mode
            this.$drawing_mode.value = prev_mode;
            return;
        }

        await this.sam_modal_ref.current!.show_downloading()

        // // NOTE: starting onnx download first, because smaller, no await here
        // const onnxfilepromise:Promise<Error|Response> = 
        //     base.util.fetch_no_throw(`proxy?url=${HARDCODED_ONNX_URL}`)
        // const encoderfile:File|Error = await fetch_with_progress(
        //     new URL(`proxy?url=${HARDCODED_ENCODER_URL}`, self.location.origin),
        //     (progress:{total:number, received:number}) => {
        //         const percent:number = 100 * progress.received / progress.total;
        //         this.sam_modal_ref.current!.show_downloading(percent)
        //     }
        // )
        // const onnxfileresponse:Response|Error = await onnxfilepromise;
        // if(encoderfile instanceof Error || onnxfileresponse instanceof Error){
        //     // TODO: unlock modal / show error
        //     base.errors.show_error_toast('Failed to download Segment Anything')
        //     this.$drawing_mode.value = prev_mode;
        //     return;
        // }
        // const response0:Response|Error = 
        //     await base.util.upload_file_no_throw(encoderfile, `upload_model/sam/${HARDCODED_ENCODER_FILENAME}`)
        // const onnxfile = new File([await onnxfileresponse.blob()], HARDCODED_ONNX_FILENAME)
        // const response1:Response|Error = 
        //     await base.util.upload_file_no_throw(onnxfile, `upload_model/sam/${HARDCODED_ONNX_FILENAME}`)
        // // TODO: check responses

        await this.sam_modal_ref.current!.show_initializing()
        const imsize:base.util.ImageSize|Error = 
            await base.imagetools.read_image_size(this.props.input)
        if(imsize instanceof Error){
            // TODO: unlock modal / show error
            base.errors.show_error_toast('Failed to initialize Segment Anything')
            // back to previous mode
            this.$drawing_mode.value = prev_mode;
            return;
        }
        this.#sam_orig_im_size = imsize;
        

        // send input file to flask via CARROT_Backend
        const embedding:Float32Array|Error = 
            await backend.sam_encode(this.props.input)
        if(embedding instanceof Error){
            // TODO: unlock modal / show error
            base.errors.show_error_toast('Failed to initialize Segment Anything')
            // back to previous mode
            this.$drawing_mode.value = prev_mode;
            return;
        }
        
        const session:Error|onnx_sam.ONNX_SamSession = 
            await onnx_sam.ONNX_SamSession.initialize(
                `models/sam_DEBUG/${HARDCODED_ONNX_FILENAME}`
            )
        if(session instanceof Error){
            // TODO: unlock modal / show error
            console.error('ONNX session error: ', session)
            base.errors.show_error_toast('Failed to initialize Segment Anything')
            // back to previous mode
            this.$drawing_mode.value = prev_mode;
            return
        }

        this.#sam_embeddings = embedding;
        sam_onnx_session = session;

        await this.sam_modal_ref.current!.close()
    }

    on_sam_new_box = async (box:Box) => {
        // send embeddings + box to onnx
        if(!this.#sam_embeddings 
        || !sam_onnx_session 
        || !this.#sam_orig_im_size){
            console.error('Cannot run SAM decoder. Not preprocessed')
            return;
        }

        const output:onnx_sam.SamOutput|Error = 
            await sam_onnx_session.process_box(
                this.#sam_embeddings, 
                box, 
                this.#sam_orig_im_size
            )
        if(output instanceof Error){
            console.error('SAM decoder returned error:', output)
            return;
        }

        console.log('SAM:', box, output.mask.shape)
        this.canvas_ref.current!.sam_paste_result(output.mask.data, this.#sam_orig_im_size)
    }
}


function _get_map_for_editmode(
    mode:   CARROT_ModelTypes|null, 
    result: CARROT_Result,
): File|null {
    if(mode == 'cells' && 'cellmap' in result.data)
        return result.data.cellmap;
    if(mode == 'treerings' && 'treeringmap' in result.data)
        return result.data.treeringmap;
    return null;
}

async function fetch_with_progress(
    url: URL,
    on_progess: (x:{total:number, received:number}) => void
): Promise<File|Error> {
    const filename:string = 
        url.pathname.substring(url.pathname.lastIndexOf('/') + 1);

    const response:Response|Error = await base.util.fetch_no_throw(url);
    if(response instanceof Error)
        return response as Error;
    
    const total:number = Number(response.headers.get('content-length'));
    if(!total) 
        return new Error('Content-Length header missing');
    
    const reader:ReadableStreamDefaultReader<Uint8Array>|undefined = 
        response.body?.getReader()
    if(reader == undefined)
        return new Error('Internal Error')
    
    let received:number = 0
    const chunks:Uint8Array[] = []
    while(true) {
        try {
            const {done, value} = await reader.read();
            if(value != undefined){
                chunks.push(value)
                received += value.length
                on_progess({total, received})
            }
            if(done)
                return new File(chunks, filename)
        } catch (error) {
            return error as Error;
        }
    }
}




type EditMenuProps = {
    /** @input The currently active drawing modality (cells/rings) 
     *  or `null` if not active. */
    $active_modality: Signal<CARROT_ModelTypes|null>;

    /** @output Whether to draw, erase or use SAM */
    $drawing_mode: Signal<DrawingMode>;

    /** @output The brush size as selected by the user in the slider */
    $brush_size: Signal<number>;

    /** Callback issued when user wants to apply editing changes. 
     *  Should return false if something went wrong. */
    on_apply: () => boolean|Promise<boolean>;

    /** Callback issued when user wants to cancel the editing process */
    on_clear: () => void;

    /** Callback issued when user wants to undo the last step */
    on_undo: () => void;

    /** Callback, user wants to reverse the direction of tree rings */
    on_reverse_growth_direction: () => void;
}

class EditMenu extends preact.Component<EditMenuProps> {
    ref:preact.RefObject<HTMLDivElement> = preact.createRef()

    brush_size_slider:preact.RefObject<HTMLDivElement> = preact.createRef()

    $menu_active:Readonly<Signal<'active'|null>> = signals.computed(
        () => this.props.$active_modality.value ? 'active': null
    )

    $editing_active: Readonly<Signal<boolean>> = signals.computed(
        () => ['cells', 'treerings'].includes(
            // @ts-ignore stupid typescript
            this.props.$active_modality.value
        )
    )


    render(_props:EditMenuProps): JSX.Element {
        return (
        <div class={
            `ui simple dropdown icon item edit-menu-button ${this.$menu_active}`} 
            ref = {this.ref}
        >
            <i class="pen icon"></i>
            <div class="menu edit-menu">
                <MenuButton 
                    label = 'Edit cells'
                    icon  = 'pen'
                    $visible = { signals.computed(
                        () => ['cells', null].includes(this.props.$active_modality.value)
                    ) }
                    $highlighted = { signals.computed( 
                        () => this.props.$active_modality.value == 'cells' ) 
                    }
                    on_click = {this.on_edit_cells}
                />
                <MenuButton 
                    label = 'Edit tree rings'
                    icon  = 'pen'
                    $visible = { signals.computed(
                        () => ['treerings', null].includes(
                            this.props.$active_modality.value
                        )
                    ) }
                    $highlighted = { signals.computed( 
                        () => this.props.$active_modality.value == 'treerings' ) 
                    }
                    on_click = {this.on_edit_treerings}
                />
                <MenuButton 
                    label = 'Reverse growth direction'
                    icon  = 'exchange alternate'
                    $visible = { signals.computed(
                        () => this.props.$active_modality.value == null
                    ) }
                    // TODO: should be disabled when no result
                    on_click = {this.props.on_reverse_growth_direction}
                />
        
                <MenuDivider $visible={this.$editing_active} />
                <MenuDivider $visible={this.$editing_active} />
                <MenuButton 
                    label = 'Paint'
                    icon  = 'paint brush'
                    $visible = { this.$editing_active }
                    $highlighted = { signals.computed(
                        () => this.props.$drawing_mode.value == 'brush'
                    ) }
                    on_click = {() => this.props.$drawing_mode.value = 'brush'}
                />
                <MenuButton 
                    label = 'Erase'
                    icon  = 'eraser'
                    $visible = { this.$editing_active }
                    $highlighted = { signals.computed(
                        () => this.props.$drawing_mode.value == 'erase'
                    ) }
                    on_click = {() => this.props.$drawing_mode.value = 'erase'}
                />
                <MenuButton 
                    label = 'Segment Anything'
                    icon  = 'magic'
                    $visible = { signals.computed(
                        () => this.props.$active_modality.value == 'cells'
                    ) }
                    $highlighted = { signals.computed(
                        () => this.props.$drawing_mode.value == 'sam'
                    ) }
                    on_click = {() => this.props.$drawing_mode.value = 'sam'}
                />
        
                <MenuDivider $visible={this.$editing_active} />
                <MenuButton 
                    label = 'Brush size'
                    icon  = 'brush'
                    $visible = { signals.computed(
                        () => this.$editing_active.value 
                            && this.props.$drawing_mode.value != 'sam'
                    ) }
                > 
                    <div 
                        class = "ui slider brush-size-slider" 
                        style = "padding:0px; padding-top:5px;"
                        ref   = {this.brush_size_slider}
                    ></div>
                </MenuButton>

                <MenuDivider $visible={this.$editing_active} />
                <MenuButton 
                    label = 'Undo'
                    icon  = 'undo'
                    $visible = { this.$editing_active }
                    on_click = {this.on_undo}
                />
            
                <MenuDivider $visible={this.$editing_active} />
                <MenuButton 
                    label = 'Reset'
                    icon  = 'times red'
                    $visible = { this.$editing_active }
                    on_click = {this.on_clear}
                />
                <MenuButton 
                    label = 'Apply'
                    icon  = 'check green'
                    $visible = { this.$editing_active }
                    on_click = {this.on_apply}
                />
            </div>
        </div>
        )
    }

    override componentDidMount(): void {
        const starting_brush_size = 10
        this.props.$brush_size.value = starting_brush_size
        $(this.brush_size_slider.current)
            .slider({
                min:   0,
                max:   60,
                start: starting_brush_size,
                onChange: (x:number) => this.props.$brush_size.value = x
            })
    }

    on_edit_cells = () => {
        this.activate_mode('cells')
    }

    on_edit_treerings = () => {
        this.activate_mode('treerings')
    }

    activate_mode(mode:CARROT_ModelTypes) {
        this.on_clear()
        this.props.$active_modality.value = mode;
    }

    /** Cancel the editing process. */
    on_clear = () => {
        this.props.on_clear()
        this.props.$active_modality.value = null;
        this.props.$drawing_mode.value = 'brush';
    }

    /** Apply editing changes. */
    on_apply = async () => {
        const status:boolean = await this.props.on_apply()
        // only clear if successful
        if(status)
            this.on_clear()
    }

    on_undo = async () => {
        await this.props.on_undo()
    }
}



function MenuButton(props:{
    label:     string,
    icon?:     string,
    $visible?:     Readonly<Signal<boolean>>,
    $highlighted?: Readonly<Signal<boolean>>,
    $disabled?:    Readonly<Signal<boolean>>,
    children?:     preact.ComponentChildren,
    on_click?:     () => void,
}): JSX.Element {
    const active:string   = props.$highlighted?.value ? "active" : "";
    const disabled:string = props.$disabled?.value ? "disabled" : "";
    return <div 
        class   = {`item ${active} ${disabled}`} 
        style   = { {
            display: 
                base.ui_util.boolean_to_display_css(props.$visible?.value ?? false)
        } }
        onClick = {props.on_click}
    >
        <i class={`${props.icon} icon`}></i>
        { props.label }
        { props.children }
    </div>
}


function MenuDivider(props:{
    $visible?: Readonly<Signal<boolean>>,
}): JSX.Element {
    const css: JSX.CSSProperties = {
        display: 
            base.ui_util.boolean_to_display_css(props.$visible?.value ?? false)
    }
    return <div class="divider" style={css}></div>
}



type EditCanvasProps = {
    /** @input The currently active drawing modality (cells/rings) 
     *  or `null` if not active. */
    $active_modality: Readonly< Signal<CARROT_ModelTypes|null> >;
    
    /** @input Whether to draw, erase or use SAM */
    $drawing_mode: Readonly< Signal<DrawingMode> >;

    /** @input Drawing brush size */
    $brush_size:  Readonly< Signal<number> >

    /** @input The size of the underlying input image */
    $imagesize: Readonly< Signal<base.util.Size|null> > 

    /** Image blob to paste onto canvas when in drawing mode */
    $inputblob?: Readonly< Signal<Blob|null> >

    /** Callback issued when user specifies a box to segment with sam  */
    on_new_sam_box?: (box:Box) => void;
}

class EditCanvas extends preact.Component<EditCanvasProps> {
    ref: preact.RefObject<HTMLCanvasElement> = preact.createRef()

    /** The full image is stored after each modification in here. */
    undo_history: Blob[] = [];

    /** Clear the undo_history on every mode change */
    #_ = this.props.$active_modality.subscribe( () => {
        this.undo_history = [];
    } )

    render(props:EditCanvasProps): JSX.Element {
        let canvas: JSX.Element|null = null

        // TODO: need to paste previous result onto canvas
        if(this.props.$active_modality.value != null){
            const css:JSX.CSSProperties = {
                ...base.styles.overlay_css,
                // TODO: maybe no cursor at all, bc of the rendering offset issue
                cursor: 'crosshair',
                imageRendering:   'pixelated',
                'pointer-events': 'all',
            }
            canvas = <canvas 
                ref    = { this.ref }
                width  = { props.$imagesize.value?.width }
                height = { props.$imagesize.value?.height }
                class  = "editing-canvas overlay" 
                style  = {css}
                onMouseDown = { this.on_mousedown }
                onMouseMove = { this.on_mousemove }
            > </canvas>
        }

        return <>
            { canvas }
        </>
    }

    /** Paste input onto canvas after every update */
    override componentDidUpdate(): void {
        if(this.ref.current == null
        || !this.props.$inputblob?.value)
            return;
        
        paste_blob_onto_canvas(this.ref.current, this.props.$inputblob.value)
    }

    async clear() {
        const canvas:HTMLCanvasElement|null = this.ref.current;
        if(canvas == null)
            return;
        
        const ctx:CanvasRenderingContext2D|null = canvas.getContext('2d')
        if(ctx == null)
            return false;
        
        await this._restore_cursor_patch(ctx)
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    async undo() {
        if(this.ref.current == null
        || this.undo_history.length == 0)
            return;
        
        const blob:Blob = this.undo_history.pop()!
        await this.clear()
        await paste_blob_onto_canvas(this.ref.current, blob)
    }

    to_blob(): Promise<Blob|null> {
        this._restore_cursor_patch(null)
        const promise = new Promise( (resolve:(x:Blob|null) => void) => {
            this.ref.current?.toBlob( resolve )
        } )
        return promise;
    }

    /** Internal flag. Set when user is actively drawing. */
    _drawing:boolean = false;

    on_mousedown = async (mousedown_event:MouseEvent): Promise<boolean> => {
        if(this.ref.current == null
        || this.props.$active_modality.value == null)
            return false;
        
        // ignore if shift key is pressed; user wants to move the image
        if(mousedown_event.shiftKey)
            return false;

        const ctx:CanvasRenderingContext2D|null = this.ref.current.getContext('2d')
        if(ctx == null)
            return false;
        
        if(this.props.$drawing_mode.value == 'sam')
            return await this._sam_mousedown(mousedown_event, ctx)
        else
            return await this._brush_mousedown(mousedown_event, ctx)
    }

   
    /** Draw a cursor to indicate the brush size */
    on_mousemove = (mouse_event:MouseEvent):boolean => {
        if(this.ref.current == null)
            return false;
        
        // ignore if shift key is pressed; user wants to move the image
        if(mouse_event.shiftKey)
            return false;

        // dont draw cursor if painting/erasing
        if(this._drawing)
            return false;

        // dont draw if in SAM mode
        if(this.props.$drawing_mode.value == 'sam')
            return false;

        const ctx:CanvasRenderingContext2D|null = this.ref.current.getContext('2d')
        if(ctx == null)
            return false;
        
        this._restore_cursor_patch(ctx)
        
        const erase:boolean = this.props.$drawing_mode.value == 'erase';
        ctx.strokeStyle = "red";
        ctx.lineWidth   = Math.max(1, this.props.$brush_size.value)
        //double size for easier removing
        ctx.lineWidth = erase? ctx.lineWidth*2 : ctx.lineWidth;
        ctx.lineCap   = 'round';
        ctx.globalCompositeOperation = 'source-over';

        let p: base.util.Point = base.ui_util.page2element_coordinates(
            {x:mouse_event.pageX, y:mouse_event.pageY},
            this.ref.current, 
            this.props.$imagesize.value!,
        )
        //p = {x:Number(p.x.toFixed(0)), y:Number(p.y.toFixed(0))}

        
        this._save_cursor_patch_at_point(ctx, p)

        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();

        // dont stop propagating event
        return false;
    }


    async _brush_mousedown(
        mousedown_event: MouseEvent, 
        ctx: CanvasRenderingContext2D,
    ): Promise<boolean> {
        const erase:boolean = this.props.$drawing_mode.value == 'erase';
        ctx.strokeStyle = erase? "black" : "white";
        ctx.lineWidth   = Math.max(1, this.props.$brush_size.value);
        //double size for easier removing
        ctx.lineWidth = erase? ctx.lineWidth*2 : ctx.lineWidth;
        ctx.lineCap   = 'round';
        // actually erase, not just paint over
        ctx.globalCompositeOperation = erase? 'destination-out': 'source-over';
        
        this._drawing = true;

        this._restore_cursor_patch(ctx)
        await this._push_undo()

        type Point = base.util.Point;
        let _prev:Point|null = null
        base.ui_util.start_drag(
            mousedown_event, 
            this.ref.current!, 
            this.props.$imagesize.value!,
            // on_move
            (start:Point, end:Point) => { 
                ctx.beginPath();
                
                if(_prev == null)
                    _prev = start;
                ctx.moveTo(_prev.x, _prev.y);
                ctx.lineTo(end.x,   end.y  );
                ctx.stroke();
                
                _prev = end;
            },
            // on_end
            () => {
                this._drawing = false;
                if(_prev == null){
                    // no changes, pop previously pushed undo history state
                    this.undo_history.pop()
                }
            }
        )

        return true;
    }


    sam_paste_result(mask:Uint8Array, size:base.util.ImageSize) {
        const ctx:CanvasRenderingContext2D|null = this.ref.current!.getContext('2d')
        if(ctx == null)
            return;
        
        const canvasdata:ImageData = ctx.getImageData(0, 0, size.width, size.height)
        const rgba:Uint8ClampedArray = canvasdata.data;

        //alpha blending
        for (let i:number = 0, p:number = 0; i < mask.length; i++, p += 4) {
            if(mask[i]!) {
                rgba[p]! += 255;
                rgba[p+1]! += 255;
                rgba[p+2]! += 255;
                rgba[p+3]! += 255;
            }
            // else transparent
        }
        ctx.putImageData(canvasdata, 0, 0)
    }

    async _sam_mousedown(
        mousedown_event: MouseEvent, 
        ctx: CanvasRenderingContext2D,
    ): Promise<boolean> {
        ctx.strokeStyle = 'red';
        ctx.lineWidth   = 1;
        ctx.lineCap     = 'round';
        
        this._drawing = true;

        this._restore_cursor_patch(ctx)
        await this._push_undo()

        type Point = base.util.Point;
        base.ui_util.start_drag(
            mousedown_event, 
            this.ref.current!, 
            this.props.$imagesize.value!,
            // on_move
            (start:Point, end:Point) => { 
                this._restore_cursor_patch(ctx)

                const w:number = (end.x - start.x)
                const h:number = (end.y - start.y)
                // constructor makes sure x0/y0 is in topleft corner
                const box_ = new base.boxes.Box(start.x, start.y, end.x, end.y)
                // add 1 pixel
                const box:Box = 
                    {x0:box_.x0-1, y0:box_.y0-1, x1:box_.x1+1, y1:box_.y1+1}
                this._save_cursor_patch_at_box(ctx, box)
                ctx.strokeRect(start.x, start.y, w, h)
            },
            // on_end
            (start:Point, end:Point) => { 
                this._drawing = false;
                this._restore_cursor_patch(ctx)

                const box = new base.boxes.Box(start.x, start.y, end.x, end.y)
                this.props.on_new_sam_box?.(box)
            }
        )

        return true;
    }


    /** A patch of image data before drawing the cursor */
    _previous_patch?:{
        // left, top, width, height
        coords: [number,number,number,number],
        pixels: Uint8ClampedArray,
    } = undefined;

    /** Store a patch of image data before drawing the cursor */
    _save_cursor_patch_at_point(ctx:CanvasRenderingContext2D, p:base.util.Point){
        const patchsize:number = ctx.lineWidth*2+1;
        const box:Box = {
            x0: p.x - patchsize,
            y0: p.y - patchsize,
            x1: p.x + patchsize,
            y1: p.y + patchsize,
        }
        return this._save_cursor_patch_at_box(ctx, box)        
    }

    _save_cursor_patch_at_box(ctx:CanvasRenderingContext2D, box:Box) {
        // constructor makes sure x0/y0 is in top-left corner
        box = new base.boxes.Box( box.x0, box.y0, box.x1, box.y1 )
        const x0:number = Math.floor(box.x0)
        const y0:number = Math.floor(box.y0)
        const x1:number = Math.ceil(box.x1)
        const y1:number = Math.ceil(box.y1)

        const w:number = x1 - x0;
        const h:number = y1 - y0;
        
        const patch_coords:[number,number,number,number] = [x0, y0, w, h];
        const patchpixels:Uint8ClampedArray = 
            ctx.getImageData(...patch_coords).data;
        this._previous_patch = {
            coords: patch_coords,
            pixels: patchpixels,
        }
    }

    /** Restore a patch of image data before drawing the new cursor */
    _restore_cursor_patch(ctx:CanvasRenderingContext2D|null) {
        if(ctx == null){
            ctx = this.ref.current!.getContext('2d')
            if(ctx == null)
                return false;
        }
        if(this._previous_patch){
            const patchdata = new ImageData(
                new Uint8ClampedArray(this._previous_patch.pixels), 
                this._previous_patch.coords[2], 
                this._previous_patch.coords[3], 
            );
            ctx.putImageData(
                patchdata, 
                this._previous_patch.coords[0], 
                this._previous_patch.coords[1]
            )
        }
        this._previous_patch = undefined;
    }

    async _push_undo(): Promise<void> {
        const blob:Blob|Error = 
            await base.imagetools.canvas_to_blob(this.ref.current!)
        if(blob instanceof Blob)
            this.undo_history.push(blob);
        
        // limited to 10 undos to conserve memory
        if(this.undo_history.length > 10)
            this.undo_history.shift()
    }

}

//TODO: move to imagetools
async function paste_blob_onto_canvas(canvas:HTMLCanvasElement, blob:Blob){
    const imgbitmap:ImageBitmap = await self.createImageBitmap(blob)
    const ctx:CanvasRenderingContext2D|null = canvas.getContext('2d')
    if(ctx != null){
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(imgbitmap, 0, 0, canvas.width, canvas.height)
    }
}



type SAM_Modal_States = 
    'download-required'|'downloading'|'initializing'|'error';


class SAM_Modal extends preact.Component {
    ref: preact.RefObject<HTMLDivElement> = preact.createRef()
    progress_ref: preact.RefObject<HTMLDivElement> = preact.createRef()

    $state:Signal<SAM_Modal_States> = new Signal('download-required')



    render(): JSX.Element {
        return <div class="ui modal" ref={this.ref}>
            <div class="header">
                Segment Anything
            </div>
            <div class="image content">
                <div class="ui small image">
                    <i class="massive magic icon"></i>
                </div>
                {
                    (this.$state.value == 'download-required')?
                        this.#download_required_description() :
                    (this.$state.value == 'downloading')?
                        this.#downloading_description() :
                    (this.$state.value == 'initializing')?
                        this.#initializing_description() :
                        null
                }
            </div>
            <div class="actions">
                <button 
                    class = "ui black deny button" 
                    style = { this.#$cancel_visible.value } 
                    type  = "button"
                >
                    Cancel
                </button>
                <button 
                    class = "ui positive right labeled icon button" 
                    style = { this.#$OK_visible.value }
                    type  = "button"
                >
                    Download
                    <i class="angle right icon"></i>
                </button>
            </div>
        </div>
    }


    show_download_required(): Promise<boolean> {
        this.$state.value = 'download-required';

        const promise = new Promise(
            (resolve: (value:boolean) => void) => {
                $(this.ref.current).modal({
                    closable: true, 
                    onDeny:    () => resolve(false),
                    onApprove: () => {
                        resolve(true)
                        return false;
                    }
                }).modal('show');
            }
        )
        return promise;
    }

    async show_downloading(percent:number = 0) {
        this.$state.value = 'downloading';
        $(this.ref.current).modal({
            closable: false, 
            onDeny:    () => false,
            onApprove: () => false,
        }).modal('show')
        if(this.progress_ref.current != null)
            $(this.progress_ref.current).progress({percent});
    }

    show_initializing() {
        this.$state.value = 'initializing';

        $(this.ref.current).modal({
            closable: false, 
            onDeny:    () => false,
            onApprove: () => false,
        }).modal('show')
    }

    close() {
        $(this.ref.current).modal('hide')
    }

    show_error() {
        base.errors.show_error_toast('ERROR HANDLING NOT IMPLEMENTED')
    }

    #download_required_description():JSX.Element {
        return <div class="description">
            <p>Segment Anything is a foundation model by <a href="https://openaccess.thecvf.com/content/ICCV2023/papers/Kirillov_Segment_Anything_ICCV_2023_paper.pdf" target="_blank">Kirillov et al. (2023)</a> that can be used to accelerate cell annotation.</p>
        </div>
    }

    #downloading_description():JSX.Element {
        return <div class="description" style="width:100%">
            <p>Downloading...</p>
            <div 
                class = "ui progress" 
                style = {{marginTop:"30px"}}
                ref   = {this.progress_ref}
            >
                <div class="bar">
                    <div class="progress"></div>
                </div>
            </div>
        </div>
    }

    #initializing_description(): JSX.Element {
        return <div 
            class = "description" 
            style = {{
                width:   '100%',
                display: 'flex',
                flexDirection: 'column'
            }}
            //style = "width: 100%;display: flex;flex-direction: column;"
        >
            Encoding image, this might take several seconds.
            <div style = {{
                display: 'flex',
                width:   '100%',
                justifyContent: 'center'
            }}>
                <i class="spinner huge loading icon" style="margin-top: 20px"></i>
            </div>
        </div>
    }

    #$cancel_visible:Readonly<Signal<JSX.CSSProperties>> = signals.computed(
        () => { 
            return {
                display: base.ui_util.boolean_to_display_css(
                    this.$state.value == 'download-required'
                    || this.$state.value == 'error'
                )
            }
        }
    )

    #$OK_visible:Readonly<Signal<JSX.CSSProperties>> = signals.computed(
        () => { 
            return {
                display: base.ui_util.boolean_to_display_css(
                    this.$state.value == 'download-required'
                )
            }
        }
    )
}
