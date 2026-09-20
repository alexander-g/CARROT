import { base, Signal, signals, JSX, preact } from "../dep.ts"


export function MenuButton(props:{
    label:         string,
    icon?:         string,
    $visible?:     Readonly<Signal<boolean>>,
    $highlighted?: Readonly<Signal<boolean>>,
    $disabled?:    Readonly<Signal<boolean>>,
    tooltip?:      string,
    children?:     preact.ComponentChildren,
    on_click?:     () => void,
    on_icon_click?:() => void,
}): JSX.Element {
    const active:string   = props.$highlighted?.value ? "active" : "";
    const disabled:string = props.$disabled?.value ? "disabled" : "";
    return <div 
        class   = {`item ${active} ${disabled}`} 
        style   = { {
            display: 
                base.ui_util.boolean_to_display_css(props.$visible?.value ?? true)
        } }
        onClick = {props.on_click}
        data-tooltip  = { props.tooltip }
        data-position = "right center"
    >
        <i class={`${props.icon} icon`} onClick={props.on_icon_click}></i>
        { props.label }
        { props.children }
    </div>
}


export function MenuDivider(props:{
    $visible?: Readonly<Signal<boolean>>,
}): JSX.Element {
    const css: JSX.CSSProperties = {
        display: 
            base.ui_util.boolean_to_display_css(props.$visible?.value ?? true)
    }
    return <div class="divider" style={css}></div>
}


export class MenuSlider extends preact.Component<{
    label:    string,
    icon:     string,

    /** @input @output */
    $value:   Signal<number>
    minimum:  number,
    maximum:  number,

    $active?:  Readonly<Signal<boolean>>
    $visible?: Readonly<Signal<boolean>>
}> {
    render(): JSX.Element {
        return <MenuButton 
            label     = { this.props.label }
            icon      = { this.props.icon }
            $visible  = { this.props.$visible }
            $disabled = { 
                signals.computed( () => !(this.props.$active?.value ?? true) ) 
            }
            on_icon_click  = { this.on_button_click }
        > 
            <div 
                class = "ui slider brush-size-slider" 
                style = "padding:0px; padding-top:5px;"
                ref   = { this.ref }
            ></div>
        </MenuButton>
    }

    ref: preact.RefObject<HTMLDivElement> = preact.createRef()

    override componentDidMount(): void {
        $(this.ref.current)
            .slider({
                min:   this.props.minimum,
                max:   this.props.maximum,
                start: this.props.$value.value,
                onMove: (x:number) => this.props.$value.value = x
            })
    }

    #_1 = this.props.$value.subscribe((newvalue:number) => {
        $(this.ref.current).slider('set value', newvalue)
    })

    on_button_click = () => {
        const old_value:unknown = $(this.ref.current).slider('get value')
        if(typeof old_value != 'number') {
            console.warn('MenuSlider:get value is not a number', old_value)
            return
        }
        
        this.props.$value.value = 
            (old_value > this.props.minimum) 
            ? this.props.minimum 
            : this.props.maximum
    }
}
