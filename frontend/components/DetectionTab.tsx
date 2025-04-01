import { base, Signal, signals, JSX, preact } from "../dep.ts"
import { CARROT_State }  from "./state.ts"
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


export 
class CARROT_DetectionTab extends base.detectiontab.DetectionTab<CARROT_State> {
    override resultclass() {
        return CARROT_Result;
    }

    override file_table_content() {
        return CARROT_Content;
    }
}



export 
class CARROT_Content extends base.SingleFileContent<CARROT_Result>{
    canvas_ref: preact.RefObject<EditCanvas> = preact.createRef()
    edit_menu_ref: preact.RefObject<EditMenu> = preact.createRef()
    
    $active_editing_mode: Signal<CARROT_ModelTypes|null> = new Signal(null)
    $editing_brush_size:  Signal<number> = new Signal(0)
    
    /** Flag indicating to erase rather than to paint */
    $erase: Signal<boolean> = new Signal(false)

    $treering_points: Readonly<Signal<PointPair[][]>> = signals.computed( () => { 
        return this.props.$result.value.get_treering_coordinates_if_loaded() ?? [] 
    })

    $overlays_visible:Readonly<Signal<boolean>> = signals.computed(() => {
        console.log('$overlays_visible:', this.$result_visible.value, this.$active_editing_mode.value, this.$result_visible.value && (this.$active_editing_mode.value == null) )
        return this.$result_visible.value && (this.$active_editing_mode.value == null)
    })


    override result_overlays(): JSX.Element {
        const result:CARROT_Result = this.props.$result.value;
        // TODO: not only colored_cellmap
        const overlayimage:File|null = 
            ('colored_cellmap' in result.data)? result.data.colored_cellmap : 
            ('cellmap' in result.data)? result.data.cellmap :
            ('treeringmap' in result.data)? result.data.treeringmap : null;
        return <>
            <base.imageoverlay.ImageOverlay 
                image     = {overlayimage}        
                $visible  = {this.$overlays_visible}
            />
            <TreeringsSVGOverlay 
                size = { this.$og_imagesize.value ?? {height:0, width:0} }
                $result = { this.props.$result }
                $scale  = { this.$scale }
                $visible = { this.$overlays_visible }
            />
            <EditCanvas 
                ref = {this.canvas_ref} 
                $active_mode = { this.$active_editing_mode }
                $erase       = { this.$erase }
                $imagesize   = { this.$og_imagesize }
                $brush_size  = { this.$editing_brush_size }
                $inputblob   = { signals.computed(() => 
                    _get_map_for_editmode(
                        this.$active_editing_mode.value,
                        this.props.$result.value,
                    )
                ) }
            />
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
                on_reverse_growth_direction = {this.on_reverse_growth_direction}
                $active_mode = { this.$active_editing_mode }
                $erase       = { this.$erase }
                $brush_size  = { this.$editing_brush_size }
            />
        ]
    }

    on_apply_editing_changes = async () => {
        type GenericBackend = base.files.ProcessingModule<File, CARROT_Result>;
        const backend:GenericBackend|CARROT_Backend|null = 
            this.props.$processingmodule.value
        const mode:CARROT_ModelTypes|null = this.$active_editing_mode.value
        if(!(backend instanceof CARROT_Backend)
        || mode == null)
            return;
        const blob:Blob|null = await this.canvas_ref.current!.to_blob()
        if(blob == null)
            return;
        
        const current_data:CARROT_Data = this.props.$result.value.data;
        const current_rings:TreeringInfo[] = 
            ('treerings' in current_data)? current_data.treerings : []
        const current_years:number[] = current_rings.map(
            (ring:TreeringInfo) => ring.year
        )
        const filename = `${this.props.input.name}.${mode}.png`
        const file = new File([blob], filename)
        
        const maybe_cellmap:File|null = 
            ('cellmap' in current_data)? current_data.cellmap : null;
        const maybe_treeringmap:File|null = 
            ('treeringmap' in current_data)? current_data.treeringmap : null;
        const unfinished_result:UnfinishedCARROT_Result = {
            status:    'processing',
            inputname: this.props.input.name,
            data: (mode == 'cells')? {
                cellmap:     file,
                //treeringmap: maybe_treeringmap,
                ...(maybe_treeringmap? {treeringmap:maybe_treeringmap} : {})
            } : {
                //cellmap:     maybe_cellmap,
                ...(maybe_cellmap? {cellmap:maybe_cellmap} : {}),
                treeringmap: file,
            }
        }
        // awkward
        this.props.$result.value = new CARROT_Result('processing');
        const edited_result:CARROT_Result = 
            await backend.process_cell_association(unfinished_result)

        // re-apply potentially edited years
        const edited_ring_points:PointPair[][] = 
            edited_result.get_treering_coordinates_if_loaded() ?? []
        const finished_rings:TreeringInfo[] = 
            _zip_into_treerings(edited_ring_points, current_years)
        if('treerings' in edited_result.data)
            edited_result.data.treerings = finished_rings;

        this.props.$result.value = edited_result;
    }

    on_reverse_growth_direction = () => {
        this.props.$result.value = 
            CARROT_Result.reverse_growth_direction(this.props.$result.value)
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



type EditMenuProps = {
    /** @output The currently active drawing mode or `null` if not active. */
    $active_mode: Signal<CARROT_ModelTypes|null>;

    /** @output The brush size as selected by the user in the slider */
    $brush_size: Signal<number>;

    /** @output Flag indicating to erase rather than to paint */
    $erase: Signal<boolean>;

    /** Callback issued when user wants to apply editing changes */
    on_apply: () => void;

    /** Callback issued when user wants to cancel the editing process */
    on_clear: () => void;

    /** Callback, user wants to reverse the direction of tree rings */
    on_reverse_growth_direction: () => void;
}

class EditMenu extends preact.Component<EditMenuProps> {
    ref:preact.RefObject<HTMLDivElement> = preact.createRef()

    brush_size_slider:preact.RefObject<HTMLDivElement> = preact.createRef()
    edit_cells_button:preact.RefObject<HTMLDivElement> = preact.createRef()
    edit_treerings_button:preact.RefObject<HTMLDivElement> = preact.createRef()

    $menu_active:Readonly<Signal<'active'|null>> = signals.computed(
        () => this.props.$active_mode.value ? 'active': null
    )

    $erase_active: Readonly<Signal<'active'|null>> = signals.computed(
        () => this.props.$erase.value ? 'active' : null
    )
    $paint_active: Readonly<Signal<'active'|null>> = signals.computed(
        () => this.props.$erase.value ? null : 'active'
    )


    render(_props:EditMenuProps): JSX.Element {
        return (
        <div class={
            `ui simple dropdown icon item edit-menu-button ${this.$menu_active}`} 
            ref = {this.ref}
        >
            <i class="pen icon"></i>
            <div class="menu edit-menu">
                <div 
                    class = "item edit-mode edit-cells" 
                    onClick = {this.on_edit_cells}
                    ref = {this.edit_cells_button}
                >
                    <i class="pen icon"></i>
                    Edit cells
                </div>
                <div
                    class = "item edit-mode edit-treerings" 
                    onClick = {this.on_edit_treerings}
                    ref = {this.edit_treerings_button}
                >
                    <i class="pen icon"></i>
                    Edit tree rings
                </div>
                <div
                    class = "item edit-mode edit-growth-direction" 
                    onClick = {this.props.on_reverse_growth_direction}
                >
                    <i class="exchange alternate icon"></i>
                    Reverse growth direction
                </div>
        
                <div class="divider hidden-when-disabled"></div>
                <div class="divider hidden-when-disabled"></div>
                <div 
                    class = {`item paint-mode hidden-when-disabled ${this.$paint_active}` }
                    onClick = { () => this.props.$erase.value = false }
                >
                    <i class="paint brush icon"></i>
                    Paint
                </div>
                <div 
                    class   = {`item erase-mode hidden-when-disabled ${this.$erase_active}` }
                    onClick = { () => this.props.$erase.value = true }
                >
                    <i class="eraser icon"></i>
                    Erase
                </div>
        
                <div class="divider hidden-when-disabled"></div>
                <div class="item brightness hidden-when-disabled">
                    <i class="brush icon"></i>
                    Brush size
                    <div 
                        class = "ui slider brush-size-slider" 
                        style = "padding:0px; padding-top:5px;"
                        ref   = {this.brush_size_slider}
                    ></div>
                </div>
            
                <div class="divider hidden-when-disabled"></div>
                <div 
                    class = "item edit-clear hidden-when-disabled" 
                    onClick = {this.on_clear}
                >
                    <i class="times icon"></i>
                    Reset
                </div>
                <div 
                    class = "item edit-apply hidden-when-disabled" 
                    onClick = {this.on_apply}
                >
                    <i class="check icon"></i>
                    Apply
                </div>
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
        $('.hidden-when-disabled').hide()
        //this.submenu_ref.current!.style.display = 'none';
    }

    on_edit_cells = () => {
        this.activate_mode('cells')
    }

    on_edit_treerings = () => {
        this.activate_mode('treerings')
    }

    activate_mode(mode:CARROT_ModelTypes) {
        this.on_clear()

        if(mode == 'cells'){
            this.edit_treerings_button.current?.classList.add('disabled')
            this.edit_cells_button.current?.classList.add('active')
        }
        if(mode == 'treerings'){
            this.edit_cells_button.current?.classList.add('disabled')
            this.edit_treerings_button.current?.classList.add('active')
        }
        $(this.ref.current).find('.hidden-when-disabled').show()

        this.props.$active_mode.value = mode;
    }

    /** Cancel the editing process. */
    on_clear = () => {
        //$root.find('.edit-menu .hidden-when-disabled').hide()
        //$root.find('.edit-menu-button, .edit-mode').removeClass('active disabled')

        this.props.on_clear()

        // TODO: overlays
        // const canvas = $root.find('.editing-canvas.overlay')[0]
        // canvas.getContext('2d').clearRect(0,0,canvas.width, canvas.height)
        // $(canvas).css('pointer-events', 'none')

        // //show the other overlays again
        // const $other_overlays  = $(`[filename="${filename}"] .overlay:not(canvas)`)
        // $other_overlays.css('visibility', '')

        this.edit_cells_button.current?.classList.remove('disabled', 'active')
        this.edit_treerings_button.current?.classList.remove('disabled', 'active')
        $(this.ref.current).find('.hidden-when-disabled').hide()

        this.props.$active_mode.value = null;
    }

    /** Apply editing changes. */
    on_apply = async () => {
        await this.props.on_apply()
        this.on_clear()
    }
}


type EditCanvasProps = {
    /** @input The currently active drawing mode or `null` if not active. */
    $active_mode: Readonly< Signal<CARROT_ModelTypes|null> >;
    
    /** Whether to erase rather than draw */
    $erase: Readonly<Signal<boolean>>;

    /** @input Drawing brush size */
    $brush_size:  Readonly< Signal<number> >

    /** @input The size of the underlying input image */
    $imagesize: Readonly< Signal<base.util.Size|null> > 

    /** Image blob to paste onto canvas when in drawing mode */
    $inputblob?: Readonly< Signal<Blob|null> >
}

class EditCanvas extends preact.Component<EditCanvasProps> {
    ref: preact.RefObject<HTMLCanvasElement> = preact.createRef()

    render(props:EditCanvasProps): JSX.Element {
        let canvas: JSX.Element|null = null

        // TODO: need to paste previous result onto canvas
        if(this.props.$active_mode.value != null){
            const css = {
                ...base.styles.overlay_css,
                cursor: 'crosshair',
                'pointer-events': 'all',
            }
            canvas = <canvas 
                ref    = { this.ref }
                width  = { props.$imagesize.value?.width }
                height = { props.$imagesize.value?.height }
                class  = "editing-canvas overlay" 
                style  = {css}
                onMouseDown = { this.on_mousedown }
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

    apply() {
        this.ref.current?.toBlob( (blob:Blob|null) => {
            if(!blob){
                console.error('Could not convert canvas to blob')
                return;
            }


        } )
    }

    clear() {
        
    }

    to_blob(): Promise<Blob|null> {
        const promise = new Promise( (resolve:(x:Blob|null) => void) => {
            this.ref.current?.toBlob( resolve )
        } )
        return promise;
    }

    on_mousedown = (mousedown_event:MouseEvent):boolean => {
        if(this.ref.current == null
        || this.props.$active_mode.value == null)
            return false;
        
        // ignore if shift key is pressed; user wants to move the image
        if(mousedown_event.shiftKey)
            return false;

        const ctx:CanvasRenderingContext2D|null = this.ref.current.getContext('2d')
        if(ctx == null)
            return false;
        
        const erase:boolean = this.props.$erase.value;
        ctx.strokeStyle = erase? "black" : "white";
        ctx.lineWidth   = this.props.$brush_size.value;
        //double size for easier removing
        ctx.lineWidth = erase? ctx.lineWidth*2 : ctx.lineWidth;
        ctx.lineCap   = 'round';
        
        type Point = base.util.Point;
        let _prev:Point|null = null
        base.ui_util.start_drag(
            mousedown_event, 
            this.ref.current, 
            this.props.$imagesize.value!,
            (start:Point, end:Point) => { 
                ctx.beginPath();
                
                if(_prev == null)
                    _prev = start;
                ctx.moveTo(_prev.x, _prev.y);
                ctx.lineTo(end.x,   end.y  );
                ctx.stroke();
                
                _prev = end;
            }
        )

        // stop propagating event
        return true;
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

