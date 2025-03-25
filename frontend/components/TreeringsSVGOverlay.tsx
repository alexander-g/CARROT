import { base, preact, Signal, JSX } from "../dep.ts"
import { 
    CARROT_Result,
    TreeringInfo,
    compute_treering_width,
    _zip_into_treerings,
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

}


export
class TreeringsSVGOverlay extends preact.Component<TreeringsSVGOverlayProps> {
    ref: preact.RefObject<SVGSVGElement> = preact.createRef()

    render(props:TreeringsSVGOverlayProps): JSX.Element {
        const viewbox = `0 0 ${props.size.width} ${props.size.height}`
        const treerings_svg: JSX.Element[]|undefined = 
            props.$result.value.treerings?.map( 
                (ring:TreeringInfo, i:number) => 
                    <TreeringComponent 
                        index           = { i }
                        treering_points = { ring.coordinates } 
                        imagesize       = { props.size } 
                        parentsvg       = { this.ref.current }
                        year            = { ring.year }
                        on_new_year     = { this.on_new_year }
                        $scale          = { props.$scale }
                        px_per_um       = { props.$result.value.px_per_um ?? 1.0}
                    /> 
            )

        return <>
        <svg 
            class   = "overlay" 
            viewBox = {viewbox} 
            ref     = {this.ref}
            style   = { {
                pointerEvents:'none',
                ...base.styles.overlay_css,
            } }
        >
            { treerings_svg }
        </svg>
        </>
    }

    on_new_year = (index:number, new_year:number) => {
        const old_result:CARROT_Result = this.props.$result.value;
        const rings:TreeringInfo[] = this.props.$result.value.treerings ?? []
        if(rings.length <= index){
            console.error(`Cannot update tree ring index ${index}`)
            return;
        }

        const ring_points:PointPair[][] = 
            rings.map( (ring:TreeringInfo) => ring.coordinates )
        const year_0:number = new_year - index;
        const new_years:number[] = 
            base.util.arange(year_0, year_0 + rings.length)
        const new_rings:TreeringInfo[] = 
            _zip_into_treerings(ring_points, new_years)
        
        const new_result:CARROT_Result = new CARROT_Result(
            old_result.status,
            old_result.raw,
            old_result.inputname,
            old_result.classmap ?? undefined,
            old_result.cells ?? undefined,
            new_rings,
            old_result.cellsmap ?? undefined,
            old_result.treeringsmap ?? undefined,
            old_result.imagesize ?? undefined,
        )
        new_result.px_per_um = old_result.px_per_um;
        this.props.$result.value = new_result;
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
                        { props.year.toFixed(0) }
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
            ?? window.innerWidth * 0.9;
        const scale:number = this.props.$scale?.value ?? 1.0
        parentwidth = parentwidth / scale
        const imagewidth:number = 
            this.props.imagesize.width;
        
        return imagewidth / parentwidth * 1.5 / scale;
    }
}

