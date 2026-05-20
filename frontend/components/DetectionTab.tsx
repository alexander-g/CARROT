import { base, Signal, signals, JSX, preact } from "../dep.ts"
import { CARROT_State, is_unfinished }  from "./state.ts"
import { 
    CARROT_Result, 
    CARROT_Data,
    CARROT_Backend,
    UnfinishedCARROT_Result,
    _zip_into_treerings,
    type AoIRect,
    type Sam3Output,
} from "../lib/carrot_detection.ts"
import { TreeringsSVGOverlay, PointPair } from "./TreeringsSVGOverlay.tsx"
import { CARROT_ModelTypes }              from "../lib/carrot_settings.ts";
import * as onnx_sam                      from "../lib/onnx_sam.ts"
import { CURSORS_B64, base64_to_uint8 }   from "./cursors.ts"


export 
class CARROT_DetectionTab extends base.detectiontab.DetectionTab<CARROT_State> {
    override resultclass() {
        return CARROT_Result;
    }

    override file_table_content() {
        return CARROT_Content;
    }

    // ugly
    #_ = this.props.appstate.$available_models.subscribe(
        (avmodels:Record<string, base.settings.ModelInfo[]>|undefined) => {
            let sam_downloaded:boolean = false;
            if(avmodels && 'sam' in avmodels){
                const modelnames:string[] = avmodels['sam'].map( 
                    (info:base.settings.ModelInfo) => info.name 
                )
                const encoder_ok:boolean = 
                    modelnames.includes('sam_encoder_vit_b')
                const decoder_ok:boolean = 
                    modelnames.includes('sam_decoder_vit_b')
                sam_downloaded = (encoder_ok && decoder_ok)
            }
            CARROT_Content.sam_downloaded = sam_downloaded;

            let sam3_downloaded:boolean = false;
            if(avmodels && 'sam' in avmodels){
                const modelnames:string[] = avmodels['sam'].map( 
                    (info:base.settings.ModelInfo) => info.name 
                )
                const encoder_ok:boolean = 
                    modelnames.includes('sam3_image_encoder_full')
                const decoder_ok:boolean = 
                    modelnames.includes('sam3_decoder_with_box_feats')
                    sam3_downloaded = (encoder_ok && decoder_ok)
            }
            CARROT_Content.sam3_downloaded = sam3_downloaded;
        }
    )
}



type DrawingMode = 'brush' | 'erase' | 'sam' | 'sam3';
type Box   = base.boxes.Box;
type Point = base.util.Point;
type ImageSize = base.util.ImageSize;

type CARROT_EditingMode = CARROT_ModelTypes | 'aoi' | null;


type GenericBackend = base.files.ProcessingModule<File, CARROT_Result>;


/** Global sam onnx session because only one model */
let sam_onnx_session:onnx_sam.ONNX_SamSession|undefined = undefined;

const HARDCODED_SAM_DECODER_FILENAME = 'sam_decoder_vit_b.onnx'
//const HARDCODED_SAM_MAX_SIZE_PX = 4096;
const HARDCODED_SAM_MAX_SIZE_PX = 1024*5;


const HARDCODED_SAM_URLS = {
    'sam': {
        'encoder': `https://github.com/alexander-g/segment-anything/releases/download/v2025-09-17/sam_encoder_vit_b.torchscript`,
        'decoder': `https://github.com/alexander-g/segment-anything/releases/download/v2025-09-17/${HARDCODED_SAM_DECODER_FILENAME}`,
    },
    'sam3': {
        'encoder': `https://github.com/alexander-g/sam3-onnx/releases/download/v2026-03-13/sam3_image_encoder_full.onnx`,
        'decoder': `https://github.com/alexander-g/sam3-onnx/releases/download/v2026-03-13/sam3_decoder_with_box_feats.onnx`,
    }
}



export 
class CARROT_Content extends base.SingleFileContent<CARROT_Result>{
    canvas_ref: preact.RefObject<EditCanvas> = preact.createRef()
    edit_menu_ref: preact.RefObject<EditMenu> = preact.createRef()
    sam_modal_ref: preact.RefObject<SAM_Modal> = preact.createRef()
    svg_overlay_ref: preact.RefObject<TreeringsSVGOverlay> = preact.createRef()
    
    $active_editing_mode: Signal<CARROT_EditingMode> = new Signal(null)
    $editing_brush_size:  Signal<number> = new Signal(0)
    
    /** Whether to draw, erase or use SAM */
    $drawing_mode: Signal<DrawingMode> = new Signal('brush')

    $treering_points: Readonly<Signal<PointPair[][]>> = signals.computed( () => { 
        return this.props.$result.value.get_treering_coordinates_if_loaded() ?? [] 
    })

    /** Whether to show overlays */
    $overlays_visible:Readonly<Signal<boolean>> = signals.computed(() => {
        return this.$result_visible.value 
        && this.$active_editing_mode.value != 'cells'
        && this.$active_editing_mode.value != 'treerings'
    })

    /** Checkbox value, whether to show cells grouped by ring or individually */
    $show_grouped_cells:Signal<boolean> = new Signal(true);

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

    // TODO: ugly
    /** Indicates if sam is alread downloaded. NOTE: set from outside.*/
    static sam_downloaded: boolean = false;
    static sam3_downloaded:boolean = false;

    $image_too_large_for_sam:Signal<boolean> = new Signal(false)
    $aoi_disabled:Readonly<Signal<boolean>>  = signals.computed(
        () => !('treeringmap' in this.props.$result.value.data)
    )


    override result_overlays(): JSX.Element {
        return <>
            <base.imageoverlay.ImageOverlay 
                image     = { this.get_overlayimage() }
                $visible  = { this.$overlays_visible }
            />
            <TreeringsSVGOverlay 
                ref  = { this.svg_overlay_ref }
                size = { this.$og_imagesize.value ?? {height:0, width:0} }
                $result = { this.props.$result }
                $scale  = { this.$scale }
                $visible = { this.$overlays_visible }
                $aoi_edit_active = { signals.computed(
                    () => this.$active_editing_mode.value == 'aoi'
                )}
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
        if('colored_cellmap' in resultdata && this.$show_grouped_cells.value)
            return resultdata.colored_cellmap;
        else if('instancemap' in resultdata)
            return resultdata.instancemap
        else if('cellmap' in resultdata)
            return resultdata.cellmap
        else if('treeringmap' in resultdata)
            return resultdata.treeringmap
        else
            return null;
    }


    // NOTE: adding <SAM_Modal /> in result_overlays() caused issues
    // TODO: does not belong here, should exist only once
    override render():JSX.Element {
        return <>
            { super.render(this.props) }
            <SAM_Modal ref={this.sam_modal_ref} />
        </>
    }

    override async componentDidMount(): Promise<void> {
        const imsize:base.util.ImageSize|Error = 
            await base.imagetools.read_image_size(this.props.input)
        if(imsize instanceof Error)
            return
        
        this.$image_too_large_for_sam.value = (
            imsize.width > HARDCODED_SAM_MAX_SIZE_PX
            || imsize.height > HARDCODED_SAM_MAX_SIZE_PX
        )
    }


    // TODO: show cells / show treerings
    override view_menu_items(): JSX.Element[] {
        const base_items:JSX.Element[] = super.view_menu_items()

        const $active: Readonly<Signal<boolean>> = signals.computed(
            () => 'colored_cellmap' in this.props.$result.value.data
        )
        base_items.push(
            <base.Checkbox 
                label   = "Group cells by tree ring"
                $active = { $active }
                $value  = { this.$show_grouped_cells }
            />
        )
        return base_items
    }

    override content_menu_extras(): JSX.Element[] {
        return [
            <EditMenu 
                ref = {this.edit_menu_ref}
                on_apply = { this.on_apply_editing_changes }
                on_clear = { () => this.canvas_ref.current?.clear() }
                on_sam3_propagate = { this.on_sam3_full }
                on_undo  = { () => this.canvas_ref.current?.undo() }
                on_set_aoi_to_full_image    = {this.on_set_aoi_to_full_image}
                on_reverse_growth_direction = {this.on_reverse_growth_direction}
                $active_modality   = { this.$active_editing_mode }
                $drawing_mode      = { this.$drawing_mode }
                $brush_size        = { this.$editing_brush_size }
                $too_large_for_sam = { this.$image_too_large_for_sam }
                $aoi_disabled      = { this.$aoi_disabled }
                $can_show_sam3_propgate = { 
                    signals.computed( () => this.#$last_sam3_box.value != null ) 
                }
                key = { 0 } // to make typescript happy
            />
        ]
    }

    // TODO: needs error messages to user
    on_apply_editing_changes: () => Promise<boolean> = async () => {
        const backend:GenericBackend|CARROT_Backend|null = 
            this.props.$processingmodule.value
        const mode:CARROT_EditingMode = this.$active_editing_mode.value
        if(!(backend instanceof CARROT_Backend)
        || mode == null)
            return false;

        
        const current_data:CARROT_Data = this.props.$result.value.data;
        let new_data:CARROT_Data = {...current_data}
        
        if(mode == 'aoi') {
            const aoi_points:AoIRect|null = this.svg_overlay_ref.current!.get_aoi();

            // for type safety
            type AOITYPE_IN_DATA = Extract<CARROT_Data, { aoi: unknown }>['aoi']
            const aoi:AOITYPE_IN_DATA = aoi_points;
            new_data = {...new_data, aoi}
        }


        
        if(mode == 'cells' || mode == 'treerings'){
            const blob:Blob|null = await this.canvas_ref.current!.to_blob()
            if(blob == null)
                return false;
            
            const filename = `${this.props.input.name}.${mode}.png`
            const edited_file = new File([blob], filename)
            const attribute:string= {
                'cells'    : 'cellmap',
                'treerings': 'treeringmap',
            }[mode];
            new_data = {...new_data, [attribute]:edited_file}
        }

        const unfinished_result: UnfinishedCARROT_Result = {
            status:    'processing',
            inputname: this.props.input.name,
            data: new_data
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

    on_set_aoi_to_full_image = () => {
        this.svg_overlay_ref.current!.set_aoi_to_full_image()
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
        else if(mode == 'sam3')
            this.on_sam3_activate(this.#_prev_drawing_mode)
        
        this.#_prev_drawing_mode = mode;
    } )
    


    #sam_embeddings?:Float32Array;
    #sam_orig_im_size?:base.util.ImageSize;

    /** Download SAM (v1) if needed, send image to flask for encoding, 
     *  create a new ONNX session for the decoder. */
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
        
        // TODO: check if image not too large, incl px/um

        if(!CARROT_Content.sam_downloaded){
            const proceed:boolean = 
                await this.sam_modal_ref.current!.show_download_required('sam')
            if(!proceed) {
                // user cancelled or something went wrong, back to previous mode
                this.$drawing_mode.value = prev_mode;
                return;
            }

            const ok:boolean = await this._download_sam('sam')
            if(!ok){
                await this.sam_modal_ref.current!.show_error(
                    "Failed to download Segment Anything"
                )
                // back to previous mode
                this.$drawing_mode.value = prev_mode;
                return;
            }
        }


        await this.sam_modal_ref.current!.show_initializing()
        const imsize:base.util.ImageSize|Error = 
            await base.imagetools.read_image_size(this.props.input)
        if(imsize instanceof Error){
            await this.sam_modal_ref.current!.show_error(
                "Failed to initialize Segment Anything"
            )
            // back to previous mode
            this.$drawing_mode.value = prev_mode;
            return;
        }
        this.#sam_orig_im_size = imsize;
        

        // send input file to flask via CARROT_Backend
        const embedding:Float32Array|Error = 
            await backend.sam_encode(this.props.input)
        if(embedding instanceof Error){
            await this.sam_modal_ref.current!.show_error(
                "Failed to initialize Segment Anything"
            )
            // back to previous mode
            this.$drawing_mode.value = prev_mode;
            return;
        }
        
        const session:Error|onnx_sam.ONNX_SamSession = 
            await onnx_sam.ONNX_SamSession.initialize(
                `models/sam/${HARDCODED_SAM_DECODER_FILENAME}`
            )
        if(session instanceof Error){
            // TODO: unlock modal / show error
            console.error('ONNX session error: ', session)
            await this.sam_modal_ref.current!.show_error(
                "Failed to initialize Segment Anything"
            )
            // back to previous mode
            this.$drawing_mode.value = prev_mode;
            return
        }

        this.#sam_embeddings = embedding;
        sam_onnx_session = session;

        await this.sam_modal_ref.current!.close()
    }

    /** Download SAM3 if needed. */
    on_sam3_activate = async (prev_mode:DrawingMode) => {
        const backend:GenericBackend|CARROT_Backend|null = 
            this.props.$processingmodule.value
        if(!(backend instanceof CARROT_Backend)){
            console.error('Processing backend is not a CARROT backend', backend)
            this.$drawing_mode.value = prev_mode;
            return;
        }
        // clear last box if still there
        this.#$last_sam3_box.value = null;

        if(!CARROT_Content.sam3_downloaded) {
            const proceed:boolean = 
                await this.sam_modal_ref.current!.show_download_required('sam3')
            if(!proceed) {
                // user cancelled or something went wrong, back to previous mode
                this.$drawing_mode.value = prev_mode;
                return;
            }

            const ok:boolean = await this._download_sam('sam3')
            if(!ok){
                await this.sam_modal_ref.current!.show_error(
                    "Failed to download Segment Anything 3"
                )
                // back to previous mode
                this.$drawing_mode.value = prev_mode;
                return;
            }
        }

        await this.sam_modal_ref.current!.close()
    }


    async _download_sam(samversion:'sam'|'sam3'): Promise<boolean> {
        await this.sam_modal_ref.current!.show_downloading()

        const {encoder:encoderurl, decoder:decoderurl} = HARDCODED_SAM_URLS[samversion];

        const encoderfilename:string = base.util.file_basename(encoderurl);
        const decoderfilename:string = base.util.file_basename(decoderurl)

        const decoder_savepath = `models/sam/${decoderfilename}`
        const encoder_savepath = `models/sam/${encoderfilename}`

        // NOTE: starting encoder download first, because smaller, no await here
        const decoderfilepromise:Promise<Error|Response> = 
            base.util.fetch_no_throw(`proxy?url=${decoderurl}&savepath=${decoder_savepath}`)
        const encoderfile:File|Error = await base.util.fetch_with_progress(
            new URL(`proxy?url=${encoderurl}&savepath=${encoder_savepath}`, self.location.origin),
            (progress:{total:number|null, received:number}) => {
                const percent:number = 100 * progress.received / progress.total!;
                this.sam_modal_ref.current!.show_downloading(percent)
            }
        )
        const decoderfileresponse:Response|Error = await decoderfilepromise;
        if(encoderfile instanceof Error || decoderfileresponse instanceof Error)
            return false;

        const decoderfile: Blob|Error = 
            await decoderfileresponse.blob().catch( () => new Error() );
        if(decoderfile instanceof Error)
            return false;
        

        // TODO: need to reload settings, otherwise will download again

        // dont close modal automatically

        return true
    }

    on_sam_new_box = (box:Box) => {
        if(this.$drawing_mode.value == 'sam')
            this.on_sam1_new_box(box)
        else if(this.$drawing_mode.value == 'sam3')
            this.on_sam3_new_box(box)
        else
            console.error(`Unexpected drawing mode ${this.$drawing_mode.value}`)
    }

    on_sam1_new_box = async (box:Box) => {
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

    /** User has drawn a box in SAM3 mode, apply on a patch around the box first. */
    on_sam3_new_box = (box:Box) => {
        this.process_sam3(box, /*full=*/false)
    }

    #$last_sam3_box:Signal<Box|null> = new Signal(null);

    /** User seems happy with the sam3 box and wants to apply it the full image */
    on_sam3_full = () => {
        if(this.#$last_sam3_box.value != null)
            this.process_sam3(this.#$last_sam3_box.value, /*full=*/true)
    }

    async process_sam3(box:Box, full:boolean) {
        const backend:GenericBackend|CARROT_Backend|null = 
            this.props.$processingmodule.value
        if(!(backend instanceof CARROT_Backend)){
            console.error('Processing backend is not a CARROT backend', backend)
            return;
        }

        // TODO: awkward
        const result0:CARROT_Result = this.props.$result.value;
        this.props.$result.value = new CARROT_Result('processing');
        const on_progress = (progress:number) => {
            const r = new CARROT_Result('processing')
            // TODO: this should be part of the constructor
            r.progress = progress;
            r.message  = 'Processing full image ...' 
            this.props.$result.value = r;
        }
        const output:Sam3Output|Error = 
            await backend.sam3_encode_decode(this.props.input, box, full, on_progress)
        this.props.$result.value = result0;
        if(output instanceof Error)
            return output;
        
        this.canvas_ref.current!.sam_paste_result(output.maskdata, output.masksize)
        // set box if applied locally, clear if applied globally
        this.#$last_sam3_box.value = full? null : box;
    }
}


function _get_map_for_editmode(
    mode:   CARROT_EditingMode, 
    result: CARROT_Result,
): File|null {
    if(mode == 'cells' && 'cellmap' in result.data)
        return result.data.cellmap;
    if(mode == 'treerings' && 'treeringmap' in result.data)
        return result.data.treeringmap;
    return null;
}




type EditMenuProps = {
    /** @input-output The currently active drawing modality (cells/rings/aoi) 
     *  or `null` if not active. */
    $active_modality: Signal<CARROT_EditingMode>;

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

    /** Callback issued when user wants to apply SAM3 on the full image */
    on_sam3_propagate: () => void;

    /** Callback, user wants to reverse the direction of tree rings */
    on_reverse_growth_direction: () => void;

    /** Callback issued when user requests to set the AoI the the full image */
    on_set_aoi_to_full_image: () => void;

    /** @input If true, the "Segment Anything" button will be disabled */
    $too_large_for_sam: Readonly<Signal<boolean>>;

    /** @input If true, "Edit Area of Interest" will be disabled */
    $aoi_disabled: Readonly<Signal<boolean>>;

    /** @input If true will show "Propagate" button in sam3 mode */
    $can_show_sam3_propgate: Readonly<Signal<boolean>>;
}

class EditMenu extends preact.Component<EditMenuProps> {
    ref:preact.RefObject<HTMLDivElement> = preact.createRef()

    brush_size_slider:preact.RefObject<HTMLDivElement> = preact.createRef()

    $menu_active:Readonly<Signal<'active'|null>> = signals.computed(
        () => this.props.$active_modality.value ? 'active': null
    )

    $editing_active: Readonly<Signal<boolean>> = signals.computed(
        () => ['cells', 'treerings', 'aoi'].includes(
            // @ts-ignore stupid typescript
            this.props.$active_modality.value
        )
    )

    // TODO: do not show button sam3 output already covers the full image
    // TODO: or when not performed on a single local patch yet
    $sam3_propagate_visible: Readonly<Signal<boolean>> = signals.computed(
        () => this.$editing_active.value 
           && this.props.$drawing_mode.value == 'sam3'
           && this.props.$can_show_sam3_propgate.value
    )


    render(props:EditMenuProps): JSX.Element {
        // const sam_button_tooltip:string|undefined = 
        //     props.$too_large_for_sam.value? "Image too large" : undefined;
        
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
                    on_click = { () => this.activate_mode('cells') }
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
                    on_click = { () => this.activate_mode('treerings') }
                />
                <MenuButton 
                    label = 'Edit area of interest'
                    // icon  = 'vector square'
                    icon  = 'expand'
                    $visible = { signals.computed(
                        () => ['aoi', null].includes(
                            this.props.$active_modality.value
                        )
                    ) }
                    $highlighted = { signals.computed( 
                        () => this.props.$active_modality.value == 'aoi' ) 
                    }
                    $disabled = { this.props.$aoi_disabled }
                    on_click = { () => this.activate_mode('aoi') }
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
        
                {/* visible only if edit mode is active */}
                <EditSubMenu_CellsTreerings 
                    $active_modality   = {props.$active_modality}
                    $drawing_mode      = {props.$drawing_mode}
                    $brush_size        = {props.$brush_size}
                    $too_large_for_sam = {props.$too_large_for_sam}
                    on_undo            = {props.on_undo}
                />
                <EditSubMenu_AoI 
                    $active_modality     = {props.$active_modality} 
                    on_set_to_full_image = { props.on_set_aoi_to_full_image }
                />

            
                <MenuDivider $visible={this.$editing_active} />
                <MenuButton 
                    label = 'Reset'
                    icon  = 'times red'
                    $visible = { this.$editing_active }
                    on_click = {this.on_clear}
                />
                <MenuButton 
                    label = 'Propagate'
                    icon  = 'forward blue'
                    $visible = { this.$sam3_propagate_visible }
                    on_click = {this.on_sam3_propagate}
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


    activate_mode(mode:Exclude<CARROT_EditingMode, null>) {
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

    /** Process the full image with SAM3 */
    on_sam3_propagate = async () => {
        this.props.on_sam3_propagate()   
    }
}



type EditSubMenu_CellsTreeringsProps = {
    /** @input The currently active drawing modality (cells/rings/aoi) 
     *  or `null` if not active. */
    $active_modality: Readonly<Signal<CARROT_EditingMode>>;

    /** @output Whether to draw, erase or use SAM */
    $drawing_mode: Signal<DrawingMode>;

    /** @output The brush size as selected by the user in the slider */
    $brush_size: Signal<number>;

    /** Called when user clicks on the undo button */
    on_undo: () => unknown;

    /** @input If true, the "Segment Anything" button will be disabled */
    $too_large_for_sam: Readonly<Signal<boolean>>;
}

/** A part of the editing menu that is only shown when editing cells or treerings */
class EditSubMenu_CellsTreerings extends preact.Component<EditSubMenu_CellsTreeringsProps>{

    /** @input Whether to show this submenu */
    $active: Readonly<Signal<boolean>> = signals.computed( () => {
        return this.props.$active_modality.value == 'cells'
            || this.props.$active_modality.value == 'treerings';
    } )

    brush_size_slider:preact.RefObject<HTMLDivElement> = preact.createRef()

    render(): JSX.Element {
        const sam_button_tooltip:string|undefined = 
            this.props.$too_large_for_sam.value? "Image too large" : undefined;

        return <>
            <MenuDivider $visible={this.$active} />
            <MenuDivider $visible={this.$active} />
            <MenuButton 
                label = 'Paint'
                icon  = 'paint brush'
                $visible = { this.$active }
                $highlighted = { signals.computed(
                    () => this.props.$drawing_mode.value == 'brush'
                ) }
                on_click = {() => this.props.$drawing_mode.value = 'brush'}
            />
            <MenuButton 
                label = 'Erase'
                icon  = 'eraser'
                $visible = { this.$active }
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
                tooltip  = { sam_button_tooltip }
                $disabled = { this.props.$too_large_for_sam }
            />
            <MenuButton 
                label = 'Segment Anything 3'
                icon  = 'magic'
                $visible = { signals.computed(
                    () => this.props.$active_modality.value == 'cells'
                ) }
                $highlighted = { signals.computed(
                    () => this.props.$drawing_mode.value == 'sam3'
                ) }
                on_click = {() => this.props.$drawing_mode.value = 'sam3'}
                //tooltip  = { sam_button_tooltip }
                //$disabled = { this.props.$too_large_for_sam }0
            />

            <MenuDivider $visible={this.$active} />
            <MenuButton 
                label = 'Brush size'
                icon  = 'brush'
                $visible = { signals.computed(
                    () => this.$active.value 
                        && ( 
                            this.props.$drawing_mode.value == 'brush'
                            || this.props.$drawing_mode.value == 'erase'
                        )
                ) }
            > 
                <div 
                    class = "ui slider brush-size-slider" 
                    style = "padding:0px; padding-top:5px;"
                    ref   = {this.brush_size_slider}
                ></div>
            </MenuButton>

            <MenuDivider $visible={this.$active} />
            <MenuButton 
                label = 'Undo'
                icon  = 'undo'
                $visible = { this.$active }
                on_click = {this.props.on_undo}
            />
        </>
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
}


type EditSubMenu_AoI_Props = {
    /** @input The currently active drawing modality (cells/rings/aoi) 
     *  or `null` if not active. */
    $active_modality: Readonly<Signal<CARROT_EditingMode>>;

    /** Callback issued when user requests to set the AoI the the full image */
    on_set_to_full_image: () => void;
}

/** A part of the editing menu that is only shown when editing cells or treerings */
class EditSubMenu_AoI extends preact.Component<EditSubMenu_AoI_Props> {

    /** @input Whether to show this submenu */
    $active: Readonly<Signal<boolean>> = signals.computed( () => {
        return this.props.$active_modality.value == 'aoi';
    } )


    render(): JSX.Element {
        return <>
            <MenuDivider $visible={this.$active} />
            <MenuButton 
                label = 'Set to full image'
                icon  = 'vector square'
                $visible = { this.$active }
                on_click = {this.props.on_set_to_full_image}
            />
        </>
    }
}




function MenuButton(props:{
    label:     string,
    icon?:     string,
    $visible?:     Readonly<Signal<boolean>>,
    $highlighted?: Readonly<Signal<boolean>>,
    $disabled?:    Readonly<Signal<boolean>>,
    tooltip?:      string,
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
        data-tooltip  = { props.tooltip }
        data-position = "right center"
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
    $active_modality: Readonly< Signal<CARROT_EditingMode> >;
    
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

    /** @input Whether the canvas should be drawing */
    $active: Readonly<Signal<boolean>> = signals.computed( 
        () => (this.props.$active_modality.value == 'cells'
            || this.props.$active_modality.value == 'treerings'
        )
    )

    /** The full image is stored after each modification in here. */
    undo_history: Blob[] = [];

    /** Clear the undo_history on every mode change */
    #_ = this.$active.subscribe( () => {
        this.undo_history = [];
    } )

    render(props:EditCanvasProps): JSX.Element {
        let canvas: JSX.Element|null = null

        // TODO: need to paste previous result onto canvas
        if(this.$active.value){
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
        || !this.$active.value)
            return false;
        
        // ignore if shift key is pressed; user wants to move the image
        if(mousedown_event.shiftKey)
            return false;

        const ctx:CanvasRenderingContext2D|null = this.ref.current.getContext('2d')
        if(ctx == null)
            return false;
        
        if(['sam', 'sam3'].includes(this.props.$drawing_mode.value))
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

        // draw only in brush and erase modes
        if(!(this.props.$drawing_mode.value == 'brush'
           || this.props.$drawing_mode.value == 'erase'))
            return false;
        
        const erase:boolean    = this.props.$drawing_mode.value == 'erase';
        const brushsize:number = Math.max(1, this.props.$brush_size.value)
        let   diameter:number  = erase? brushsize*2 : brushsize;
        const cursor_b64:string|undefined = CURSORS_B64[diameter]
        if(!cursor_b64)
            return false
        const cursormask:Uint8Array = base64_to_uint8(cursor_b64)
        // actual diameter depends on mask
        diameter = Math.sqrt(cursormask.length)

        const ctx:CanvasRenderingContext2D|null = this.ref.current.getContext('2d')
        if(ctx == null)
            return false;
        this._restore_cursor_patch(ctx)

        const p: Point = base.ui_util.page2element_coordinates(
            {x:mouse_event.pageX, y:mouse_event.pageY},
            this.ref.current, 
            this.props.$imagesize.value!,
        )
        this._save_cursor_patch_at_point(ctx, p, diameter*2+1)

        const p0 = {
            x: Number( (p.x - diameter/2).toFixed(0) ), 
            y: Number( (p.y - diameter/2).toFixed(0) ),
        }
        const box:Box = {
            x0: p0.x,
            y0: p0.y,
            x1: p0.x + diameter,
            y1: p0.y + diameter,
        }
        this._paste_cursor(ctx, cursormask, box, [255,0,0,255])

        // dont stop propagating event
        return false;
    }


    async _brush_mousedown(
        mousedown_event: MouseEvent, 
        ctx: CanvasRenderingContext2D,
    ): Promise<boolean> {
        const erase:boolean = this.props.$drawing_mode.value == 'erase';
        const brushsize:number = Math.max(1, this.props.$brush_size.value)
        let   diameter:number = erase? brushsize*2 : brushsize;
        const cursor_b64:string|undefined = CURSORS_B64[diameter]
        if(!cursor_b64)
            return false;
        const cursormask:Uint8Array = base64_to_uint8(cursor_b64)
        // actual diameter depends on mask
        diameter = Math.sqrt(cursormask.length)

        const color:[number,number,number,number] = 
            erase? [0,0,0,0] : [255,255,255,255];
        
        this._drawing = true;

        this._restore_cursor_patch(ctx)
        await this._push_undo()

        let _prev:Point|null = null
        base.ui_util.start_drag(
            mousedown_event, 
            this.ref.current!, 
            this.props.$imagesize.value!,
            // on_move
            (start:Point, end:Point) => { 
                if(_prev == null)
                    _prev = start;
                
                const steps:Point[] = interpolate_points(_prev, end, diameter/3)
                for(const p of steps){
                    const p0 = {
                        x: Number( (p.x - diameter/2).toFixed(0) ), 
                        y: Number( (p.y - diameter/2).toFixed(0) ),
                    }
                    const box:Box = {
                        x0: p0.x,
                        y0: p0.y,
                        x1: p0.x + diameter,
                        y1: p0.y + diameter,
                    }
                    this._paste_cursor(ctx, cursormask, box, color)
                }
                
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


    sam_paste_result(mask:Uint8Array, size:ImageSize) {
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

    _paste_cursor(
        ctx: CanvasRenderingContext2D,
        cursormask: Uint8Array, 
        box: Box, 
        color: [number,number,number,number],
    ) {
        const x0:number = Math.floor(box.x0)
        const y0:number = Math.floor(box.y0)
        const x1:number = Math.ceil(box.x1)
        const y1:number = Math.ceil(box.y1)

        const canvaswidth:number  = this.ref.current!.width;
        const canvasheight:number = this.ref.current!.height;
        const sx:number = Math.max(0, x0);
        const sy:number = Math.max(0, y0);
        const sw:number = Math.max(0, Math.min(canvaswidth, x1) - sx);
        const sh:number = Math.max(0, Math.min(canvasheight, y1) - sy);
        if (sw === 0 || sh === 0) 
            return;

        const canvasdata:ImageData = 
            ctx.getImageData(sx, sy, sw, sh);
        const rgba:Uint8ClampedArray = canvasdata.data;

        const cursormaskwidth:number = x1 - x0;
        // do not start at zero if close to border
        let iter:number = (sy - y0) * cursormaskwidth + (sx - x0)
        for (let row:number = 0; row < sh; row++) {
            for (let col:number = 0; col < sw; col++) {
                //const p:number = (col + row * canvaswidth) * 4;
                const p:number = (col + row * sw) * 4;

                if(cursormask[iter]!) {
                    rgba[p]!   = color[0];  // R
                    rgba[p+1]! = color[1];  // G
                    rgba[p+2]! = color[2];  // B
                    rgba[p+3]! = color[3];  // A
                }
                iter++;
            }
            // if close to left border
            iter += (sx - x0);
            // if close to right border
            if(x0 >= 0)
                iter += (cursormaskwidth - sw)
        }
        ctx.putImageData(canvasdata, sx, sy)
    }


    async _sam_mousedown(
        mousedown_event: MouseEvent, 
        ctx: CanvasRenderingContext2D,
    ): Promise<boolean> {
        ctx.strokeStyle = 'red';
        ctx.lineCap     = 'round';
        ctx.lineWidth   = 1.5 * (1.0 / this._px_per_pt());
        
        this._drawing = true;

        this._restore_cursor_patch(ctx)
        await this._push_undo()

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
                //const box:Box = 
                //    {x0:box_.x0-1, y0:box_.y0-1, x1:box_.x1+1, y1:box_.y1+1}
                const box:Box = {
                    x0: box_.x0 - ctx.lineWidth,
                    y0: box_.y0 - ctx.lineWidth,
                    x1: box_.x1 + ctx.lineWidth,
                    y1: box_.y1 + ctx.lineWidth,
                }
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

    /** The current display size (px) of one image unit (pt). */
    _px_per_pt() {
        const canvas_width:number = 
            this.ref.current?.getBoundingClientRect().width 
            // deno-lint-ignore no-window
            ?? window.innerWidth * 0.9;
        const pt_width:number  = this.props.$imagesize.value!.width;
        const px_per_pt:number = canvas_width / pt_width
        console.log(`DEBUG ${px_per_pt}:`) // @agents: roast me if I forget to remove this
        return px_per_pt
    }


    /** A patch of image data before drawing the cursor */
    _previous_patch?:{
        // left, top, width, height
        coords: [number,number,number,number],
        pixels: Uint8ClampedArray,
    } = undefined;

    /** Store a patch of image data before drawing the cursor */
    _save_cursor_patch_at_point(
        ctx:       CanvasRenderingContext2D, 
        p:         Point, 
        patchsize: number,
    ){
        //const patchsize:number = ctx.lineWidth*2+1;
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

/** Returns an array of points starting at a and ending at b, spaced by step */
function interpolate_points(a: Point, b: Point, step: number): Point[] {
    if (step <= 0) 
        return [b];
    const dx:number = b.x - a.x;
    const dy:number = b.y - a.y;
    const distance:number = Math.hypot(dx, dy);
    if (distance === 0) 
        return [b];
    const n:number = Math.ceil(distance / step);
    const result: Point[] = new Array(n + 1);
    for (let i:number = 0; i <= n; i++) {
        const t:number = i / n;
        result[i] = { x: a.x + dx * t, y: a.y + dy * t };
    }
    return result;
}


type SAM_Modal_States = 
    'download-required'|'downloading'|'initializing'|'error';

type SAM_Modal_State = {
    samversion: 'sam'|'sam3',
    state: 'download-required'|'downloading'|'initializing'|'error'
}


class SAM_Modal extends preact.Component {
    ref: preact.RefObject<HTMLDivElement> = preact.createRef()
    progress_ref: preact.RefObject<HTMLDivElement> = preact.createRef()

    $state:Signal<SAM_Modal_State> = new Signal({
        state: 'download-required',
        samversion: 'sam',
    })



    render(): JSX.Element {
        const state:SAM_Modal_State = this.$state.value;
        return <div class="ui modal" ref={this.ref}>
            <div class="header">
                Segment Anything
            </div>
            <div class="image content">
                <div class="ui small image">
                    <i class="massive magic icon"></i>
                </div>
                {
                    (state.state == 'download-required')?
                        this.#download_required_description(state.samversion) :
                    (state.state == 'downloading')?
                        this.#downloading_description() :
                    (state.state == 'initializing')?
                        this.#initializing_description() :
                    (state.state == 'error')?
                        this.#error_description() :
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


    show_download_required(samversion:'sam'|'sam3'): Promise<boolean> {
        this.$state.value = {
            state: 'download-required',
            samversion,
        };

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
        this.$state.value = {
            state:'downloading',
            samversion: this.$state.value.samversion
        };
        $(this.ref.current).modal({
            closable: false, 
            onDeny:    () => false,
            onApprove: () => false,
        }).modal('show')

        $(this.progress_ref.current).progress({percent});
    }

    show_initializing() {
        this.$state.value = {
            state:'initializing',
            samversion: this.$state.value.samversion
        };;

        $(this.ref.current).modal({
            closable: false, 
            onDeny:    () => false,
            onApprove: () => false,
        }).modal('show')
    }

    close() {
        $(this.ref.current).modal('hide')
    }


    #error_message:string = 'Error'

    show_error(message:string) {
        this.$state.value = {
            state:'error',
            samversion: this.$state.value.samversion
        };
        $(this.ref.current).modal({
            closable: true,
        }).modal('show')
        this.#error_message = message;
    }

    #error_description():JSX.Element {
        self.setTimeout(
            () => $(this.progress_ref.current).progress('set error'),
            500,
        )
        return <div class="description" style="width:100%">
            <p>{ this.#error_message }</p>
            <div 
                class = "ui progress error" 
                style = {{marginTop:"30px"}}
                ref = {this.progress_ref}
            >
                <div class="bar">
                    <div class="progress"></div>
                </div>
            </div>
        </div>
    }

    #download_required_description_sam():JSX.Element {
        return <div class="description">
            <p>Segment Anything is a foundation model by <a href="https://openaccess.thecvf.com/content/ICCV2023/papers/Kirillov_Segment_Anything_ICCV_2023_paper.pdf" target="_blank">Kirillov et al. (2023)</a> that can be used to accelerate cell annotation.</p>
        </div>
    }

    #download_required_description_sam3():JSX.Element {
        return <div class="description">
            <p>Segment Anything 3 is a foundation model by <a href="https://arxiv.org/abs/2511.16719" target="_blank">
                Carion et al. (2025)</a> that can be used to annotate and detect all cells in an image without additional retraining.
            </p>
        </div>
    }

    #download_required_description(samversion:'sam'|'sam3'): JSX.Element {
        if(samversion == 'sam')
            return this.#download_required_description_sam()
        else if(samversion == 'sam3')
            return this.#download_required_description_sam3()
        else
            return <div>INTERNAL ERROR</div>
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
                    this.$state.value.state == 'download-required'
                    || this.$state.value.state == 'error'
                )
            }
        }
    )

    #$OK_visible:Readonly<Signal<JSX.CSSProperties>> = signals.computed(
        () => { 
            return {
                display: base.ui_util.boolean_to_display_css(
                    this.$state.value.state == 'download-required'
                )
            }
        }
    )
}
