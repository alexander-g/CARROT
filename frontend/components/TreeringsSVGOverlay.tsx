import { base, preact, Signal, signals, JSX } from "../dep.ts"
import { 
    CARROT_Result,
    CARROT_Data,
    TreeringInfo,
    compute_treering_width,
    _zip_into_treerings,
    AoIRect,
} from "../lib/carrot_detection.ts"

export type Point     = base.util.Point;
export type PointPair = [Point,Point];

type TreeringsSVGOverlayProps = {
    /** Size of the corresponding input image, for svg viewbox */
    size: base.util.ImageSize;

    /** Result containing treerings to display */
    $result: Signal<CARROT_Result>;

    /** The current zoom level of the image */
    $scale?: Readonly<Signal<number>>;

    /** @input whether aoi editing should be active */
    $aoi_edit_active: Readonly<Signal<boolean>>;
} & base.ui_util.MaybeHiddenProps;


export
class TreeringsSVGOverlay extends base.ui_util.MaybeHidden<TreeringsSVGOverlayProps>{
    ref: preact.RefObject<SVGSVGElement> = preact.createRef()

    
    /** Ref to the instance of {@link $drawing_aoi} */
    drawing_aoi_ref: preact.RefObject<IntermediateAoIOverlay> = preact.createRef()

    #_ = this.props.$aoi_edit_active.subscribe( (aoi_edit_active:boolean) => {
        if(aoi_edit_active) {
            const resultdata:CARROT_Data = this.props.$result.value.data;
            this.drawing_aoi_ref.current!.$coordinates.value = 
                ('aoi' in resultdata)? resultdata.aoi ?? [] : [];
        }
    } )


    render(props:TreeringsSVGOverlayProps): JSX.Element {
        const resultdata:CARROT_Data = props.$result.value.data;
        const treerings:TreeringInfo[] = 
            ('treerings' in resultdata)? resultdata.treerings : [];
        const px_per_um:number = 
            ('px_per_um' in resultdata)? resultdata.px_per_um : 1.0;
        const og_size:base.util.ImageSize = 
            ('imagesize' in resultdata)? resultdata.imagesize: props.size;
        const aoi_coordinates:AoIRect|null = 
            ('aoi' in resultdata)? resultdata.aoi : null;
        
        const viewbox = `0 0 ${og_size.width} ${og_size.height}`
        const treerings_svg: JSX.Element[]|undefined = 
            treerings.map( 
                (ring:TreeringInfo, i:number) => 
                    <TreeringComponent 
                        index           = { i }
                        treering_points = { ring.coordinates } 
                        imagesize       = { og_size } 
                        parentsvg       = { this.ref.current }
                        year            = { ring.year }
                        on_new_year     = { this.on_new_year }
                        $scale          = { props.$scale }
                        px_per_um       = { px_per_um }
                        key = {null}
                    /> 
            )

        return <>
        <svg 
            class   = "overlay" 
            viewBox = {viewbox} 
            ref     = {this.ref}
            style   = { {
                pointerEvents: props.$aoi_edit_active?.value ? 'all' : 'none',
                // NOTE: cursor only active with pointer events
                cursor: 'crosshair',
                ...base.styles.overlay_css,
                ...super.get_display_css(),
            } }
            onMouseDown = {this.on_mouse_down}
            //onKeyDown={console.log}  // TODO: 'escape' to cancel
        >
            { treerings_svg }
            
            {/* AoI overlay that is currently edited and not yet in the result */}
            <IntermediateAoIOverlay 
                ref       = {this.drawing_aoi_ref} 
                imagesize = {this.props.size}
                $active   = {this.props.$aoi_edit_active}
            />
            {/* the currently active AoI in the result */}
            {
                aoi_coordinates?
                <AoIOverlay 
                    $coordinates = { signals.computed( () => aoi_coordinates ) }
                    $active = {
                        // active when not editing
                        signals.computed( () => !this.props.$aoi_edit_active.value ) 
                    }
                /> : null
            }
        </svg>
        </>
    }

    /** Called when user wants to modify a year number */
    on_new_year = (index:number, new_year:number) => {
        const old_result:CARROT_Result = this.props.$result.value;
        const rings:TreeringInfo[] = 
            ('treerings' in old_result.data)? old_result.data.treerings : [];
        if(rings.length <= index){
            console.error(`Cannot update tree ring index ${index}`)
            return;
        }
        const new_result:CARROT_Result|null = 
            CARROT_Result.modify_year(old_result, index, new_year)
        if(new_result != null)
            this.props.$result.value = new_result;
    }

    /** Hande aoi editing. */
    on_mouse_down = (mousedown_event:MouseEvent) => {
        if(this.ref.current == null
        || this.drawing_aoi_ref.current == null
        || !this.props.$aoi_edit_active?.value)
            return;

        this.drawing_aoi_ref.current.on_mouse_down(mousedown_event, this.ref.current);
    }

    get_aoi(): AoIRect|null {
        const aoi_points:Point[] = 
            this.drawing_aoi_ref.current?.$coordinates.value ?? []
        if(aoi_points.length != 4)
            return null
        return aoi_points as AoIRect;
    }

    set_aoi_to_full_image(): void {
        this.drawing_aoi_ref.current!.$coordinates.value = [];
    }
}


type TreeringComponentProps = {
    /** Position within the list of tree rings */
    index: number;

    /** Coordinate pairs (upper and lower) of this tree ring */
    treering_points: PointPair[];
    imagesize: base.util.ImageSize;
    parentsvg: SVGSVGElement|null;
    year: number;

    /** Called when user wants to assign a new year to the tree ring */
    on_new_year: (index:number, year:number) => void;

    /** The current zoom level of the image */
    $scale?: Readonly<Signal<number>>;

    /** Pixels per um as set by user */
    px_per_um: number;
}

/** A single tree ring, from border to border */
class TreeringComponent extends preact.Component<TreeringComponentProps> {

    render(props:TreeringComponentProps): JSX.Element {
        const points_upper:string = props.treering_points.map(
            (p:PointPair) => `${p[0].x}, ${p[0].y} `
        ).join(' ')
        const points_lower:string = props.treering_points.map(
            (p:PointPair) => `${p[1].x}, ${p[1].y} `
        ).join(' ')
        const points_poly:string = points_upper + (
            props.treering_points.reverse().map(
                (p:PointPair) => `${p[1].x}, ${p[1].y} `
            ).join(' ')
        )

        const ring_width:number = 
            compute_treering_width(this.props.treering_points) / props.px_per_um;

        const css_border = {
            stroke:         "white",
            'stroke-width': "8",
            fill:           "none",
        }
        const label_position:Point =
            mean_point( props.treering_points.flat() ) ?? {x:0, y:0}

        return <g>
            <polyline 
                class  = "treering-border upper" 
                points = {points_upper}
                style  = {css_border}
            />
            <polyline 
                class  = "treering-border lower" 
                points = {points_lower}
                style  = {css_border}
            />
            <polygon 
                class  = "treering-area" 
                points = {points_poly}
            />

            <TreeringLabel 
                index     = { this.props.index } 
                year      = { this.props.year }
                width_um  = { ring_width } 
                position  = { label_position } 
                imagesize = { props.imagesize }
                parentsvg = { props.parentsvg }
                on_new_year = { props.on_new_year }
                $scale      = { props.$scale }
            />
        </g>
    }
}

function mean_point(points:Point[]): Point|null {
    if(points.length == 0)
        return null;
    
    let sum:Point = {x:0, y:0};
    for(const p of points) {
        sum = {x:sum.x + p.x, y:sum.y + p.y}
    }
    const mean:Point = { x:sum.x/points.length, y:sum.y/points.length }
    return mean;
}




type TreeringLabelProps = {
    index:    number;
    year:     number;
    width_um: number;
    position: Point;
    
    imagesize: base.util.ImageSize;
    parentsvg: SVGSVGElement|null;

    /** Called when user wants to assign a new year to the tree ring */
    on_new_year: (index:number, year:number) => void;

    /** The current zoom level of the image */
    $scale?: Readonly<Signal<number>>;
}

class TreeringLabel extends preact.Component<TreeringLabelProps>{
    #ref:     preact.RefObject<HTMLDivElement> = preact.createRef()
    #inputref:preact.RefObject<HTMLLabelElement> = preact.createRef()

    /** Size of the component (in image coordinates). Used to offset to the center */
    #$divsize: Signal<base.util.Size> = new Signal({width:0, height:0});

    #labeltext: string = ""

    render(props:TreeringLabelProps): JSX.Element {
        const scale:number = this.#estimate_scale();
        const css_fo = {
            width:     "100%",
            height:    "100%",
            transform: `scale(${scale})`,
            color:            "white",
            "font-weight":    "bold",
            "pointer-events": "none",
        }

        this.#labeltext = props.year.toFixed(0)
        return <>
        <svg 
            class = "treering-overlay-label unselectable" 
            x     = {props.position.x - this.#$divsize.value.width/2} 
            y     = {props.position.y - this.#$divsize.value.height/2}
        >
        <foreignObject style={css_fo}>
            <div class="size-query-div" style="width:fit-content;" ref={this.#ref}>
                <div>
                    <label>Year: </label>
                    <label 
                        // style set in treerings.css
                        contenteditable = "true"
                        onKeyUp   = {this.on_keyup}
                        onKeyDown = {this.on_keydown}
                        onBlur    = {this.on_blur}
                        ref       = {this.#inputref}
                    >
                        { this.#labeltext }
                    </label>
                </div>
                <label>
                    {props.width_um.toFixed(1)}μm
                </label>
            </div>
        </foreignObject>
        </svg>
        </>
    }

    override componentDidUpdate(): void {
        this.#update_divsize()
        // sometimes the label is not updated probably because of contenteditable
        // make sure it is
        this.#inputref.current!.innerText = this.#labeltext
    }

    override componentDidMount(): void {
        this.#update_divsize()
    }
    

    /** Store the size of the label after each update, 
     *  so that it can be centered properly */
    #update_divsize(): void {
        if(this.props.parentsvg == null || this.#ref.current == null)
            return
        
        const divsize:base.util.Size = 
            this.#ref.current?.getBoundingClientRect() ?? {width:0, height:0}
        
        const p0:Point|null = base.ui_util.page2element_coordinates(
            {x:0, y:0},
            this.props.parentsvg,
            this.props.imagesize,
        )
        const p1:Point|null = base.ui_util.page2element_coordinates(
            {x:divsize.width, y:divsize.height},
            this.props.parentsvg,
            this.props.imagesize,
        )
        const in_viewport_width:number = p1.x - p0.x
        const in_viewport_height:number = p1.y - p0.y

        if( 
            Math.abs(this.#$divsize.value.width - in_viewport_width) > 1 
            || Math.abs(this.#$divsize.value.height - in_viewport_height) > 1 
        )
            this.#$divsize.value = {
                width:  in_viewport_width, 
                height: in_viewport_height
            };
    }

    on_keyup = ((_event:KeyboardEvent): void => {
        // make sure there is at least a small string in the label
        // or otherwise it's basically gone
        if(this.#inputref.current?.innerText == ''){
            this.#inputref.current.innerText = '  ';
        }
    }).bind(this)

    on_keydown = ( (event:KeyboardEvent): boolean => {
        if(event.key=="Enter"){
            event.preventDefault();
            setTimeout(() => this.#inputref.current?.blur(), 0);
            return false;
        }
        return true;
    } ).bind(this)

    on_blur = ( () => {
        // TODO: use a signal so that component gets updated and position recalculated
        const label:HTMLLabelElement = this.#inputref.current!;
        const year:number = Number(label.innerText)
        if(label.innerText.trim() == '' || isNaN(year))
            label.innerText='???';
        else {
            this.props.on_new_year(this.props.index, year);
        }
    } ).bind(this)

    #estimate_scale(): number {
        let parentwidth:number = 
            this.props.parentsvg?.getBoundingClientRect().width
            // deno-lint-ignore no-window
            || window.innerWidth * 0.9;
        const scale:number = this.props.$scale?.value ?? 1.0
        parentwidth = parentwidth / scale
        const imagewidth:number = 
            this.props.imagesize.width;
        
        return imagewidth / parentwidth * 1.5 / scale;
    }
}





type AoIOverlayProps = {
    $coordinates: Signal<Point[]>;

    /** Whether to show this overlay */
    $active?: Readonly<Signal<boolean>>;

    /** Main (inner) color of the AoI overlay */
    color0: string;
    /** Secondary (outer) color of the AoI overlay */
    color1: string;
}

class AoIOverlay extends preact.Component<AoIOverlayProps> {
    static override defaultProps: 
    Pick<AoIOverlayProps, 'color0'|'color1'> = {
        color0:  'white',
        color1: '#cccccc',
    }

    render(): JSX.Element {
        if(this.props.$active?.value === false)
            // deno-lint-ignore jsx-no-useless-fragment
            return <></>
        
        let points:Point[] = this.props.$coordinates.value
        if(points.length > 0)
            points = points.concat(points[0]!)
        
        const points_svg_str:string = points.map(
            (p:Point) => `${p.x}, ${p.y} `
        ).join(' ')

        const css_border_inner: JSX.CSSProperties = {
            stroke:          this.props.color0,
            strokeWidth:     30,
            //strokeDasharray: "50%, 50%",
            strokeLinecap:   'square',
            fill:            "none",
        }
        const css_border_outer = {
            stroke:         this.props.color1,
            strokeWidth:    40,
            strokeLinecap:  'square',
            fill:           "none",
        }

        return <>
            <polyline 
                class  = "area-of-interest-line-outer" 
                points = {points_svg_str}
                style  = {css_border_outer}
            />
            <polyline 
                class  = "area-of-interest-line" 
                points = {points_svg_str}
                style  = {css_border_inner}
            />
        </>
    }
}



type IntermediateAoIOverlayProps = {
    imagesize: base.util.ImageSize;

    /** Whether to show this overlay */
    $active: Readonly<Signal<boolean>>;
}

/** An AoI that is currently being edited */
class IntermediateAoIOverlay extends preact.Component<IntermediateAoIOverlayProps> {

    $coordinates:Signal<Point[]> = new Signal([])

    /** Reset coordinates when not active */
    #_ = this.props.$active.subscribe( (active:boolean) => {
        if(!active)
            this.$coordinates.value = [];
    } )

    aoi_state:'1st-point'|'2nd-point'|'3rd-point'|'finished'|null = null;



    render(): JSX.Element {
        return <>
            <AoIOverlay 
                $coordinates = {this.$coordinates} 
                color0 = "#aaaaaa" 
                color1 = "white"
            />
        </>
    }

    on_mouse_down(mousedown_event:MouseEvent, parent:Element) {
        // ignore if shift key is pressed; user wants to move the image
        if(mousedown_event.shiftKey)
            return false;

        const n_coordinates:number = this.$coordinates.value.length;
        this.aoi_state = 
            (this.aoi_state == null)?        '1st-point' :
            (this.aoi_state == '1st-point')? '3rd-point' : 
            (this.aoi_state == '3rd-point')? 'finished'  : null;
        if(this.aoi_state == null){
            console.trace(`Should not have happened: ` 
                + `${n_coordinates} coordinates on mousedown`)
            // TODO: cancel somehow
            return;
        }

        if(this.aoi_state == '1st-point') {
            this.$coordinates.value = [];

            base.ui_util.start_drag(
                mousedown_event,
                parent,
                this.props.imagesize,
                (start:Point, current:Point) => {         //on_mousemove
                    //console.log(`AOI: mousemove`, start, end, this.props.imagesize)

                    if(this.aoi_state == '1st-point' || this.aoi_state == '2nd-point') {
                        // simply update the first two points
                        // `start` should not change between calls
                        this.$coordinates.value = [start, current]
                    }
                    else if(this.aoi_state == '3rd-point') {
                        // modify current point to be perpendicular 
                        // and create full rect

                        const p0:Point = this.$coordinates.value[0]!
                        const p1:Point = this.$coordinates.value[1]!
                        const p2:Point = current;
                        
                        const aoi_points:AoIRect = 
                            aoi_rect_from_3_points(p0, p1, p2)
                        this.$coordinates.value = aoi_points;
                    }
                    else if(this.aoi_state == 'finished')
                        // stop the dragging process
                        return 'stop';
                    
                    // else
                    return 'continue'
                },
                (start:Point, end:Point) => {         //on_mouseup

                    // const points:Point[] = this.$coordinates.value;
                    // this.$coordinates.value = [];
                    this.aoi_state = null;

                    // this.props.on_finalize(points);
                },
                // dont automatically stop dragging on mouse up, wait for 'stop'
                /* mode = */ 'manual',
            )
        }
        else if(this.aoi_state == '3rd-point')
            // add a third point
            this.$coordinates.value = 
                [...this.$coordinates.value, this.$coordinates.value[1]!]
        //else
        //    console.trace('Should not have happened')
    }
}






/**
 * Given line through p1-p2, and point p3, return point `output` such that:
 * - line through p2 and output is perpendicular to line p1-p2
 * - distance from output to line (p1-p2) equals distance from p3 to that line
 */
export function mirror_distance_perp(p1: Point, p2: Point, p3: Point): Point {
    // direction vector of line p1->p2
    const dx:number = p2.x - p1.x;
    const dy:number = p2.y - p1.y;
  
    // degenerate line: if p1 == p2, treat as zero-length -> return p2
    const len_sq:number = dx * dx + dy * dy;
    if (len_sq === 0) 
        return { ...p2 };
  
    // unit normal vector to the line
    // normal (nx, ny) = (-dy, dx) normalized
    const inv_len:number = 1 / Math.sqrt(len_sq);
    const nx:number = -dy * inv_len;
    const ny:number =  dx * inv_len;
  
    // signed distance from p3 to the line (p1-p2)
    const signed_distanec:number = ( (p3.x - p1.x) * nx + (p3.y - p1.y) * ny );
  
    return {
        x: p2.x + nx * signed_distanec,
        y: p2.y + ny * signed_distanec,
    };
}


function aoi_rect_from_3_points( p0:Point, p1:Point, p2:Point): AoIRect {
    const p3:Point = mirror_distance_perp(p0, p1, p2)
    const p4:Point = {
        x: p3.x - p1.x + p0.x,
        y: p3.y - p1.y + p0.y
    }
    return [p0, p1, p3, p4];
}

