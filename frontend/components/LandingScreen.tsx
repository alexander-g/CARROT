import { JSX, preact, Signal } from '../dep.ts'


export type LandingScreenProps = {
    $visible:          Signal<boolean>
    input_filetypes:   string[]
    on_new_files:      (files: FileList | File[]) => Promise<boolean>
    on_load_examples?: () => void
}


/** Full-window initial landing screen shown before any files are loaded. */
export class LandingScreen extends preact.Component<LandingScreenProps> {
    file_input_ref: preact.RefObject<HTMLInputElement> = preact.createRef()

    override render(props: LandingScreenProps): JSX.Element {
        const display: 'none' | 'flex' = props.$visible.value ? 'flex' : 'none'

        return <div
            id    = 'landing-screen'
            class = 'unselectable'
            style = {{
                position:       'fixed',
                inset:          0,
                zIndex:         100,
                background:     '#ffffff',
                display:        display,
                flexDirection:  'column',
                alignItems:     'center',
                justifyContent: 'center',
                paddingBottom:  '14vh',
            }}
        >
            <img
                src   = 'logo.svg'
                alt   = 'CARROT'
                style = {{ width: '360px', maxWidth: '80vw', height: 'auto' }}
            />

            <div style={{
                marginTop:     '8px',
                fontSize:      '1.1rem',
                color:         '#444444',
                letterSpacing: '0.02em',
            }}>
                {/* <b>C</b>ell <b>A</b>nd <b>R</b>ing <b>R</b>ec<b>O</b>gnition <b>T</b>ool */}
                Cell And Ring Recognition Tool
            </div>

            <div style={{
                marginTop: '60px',
                fontSize:  '1rem',
                color:     '#333333',
                textAlign: 'left',
            }}>
                <div style={{
                    fontWeight:   'bold',
                    marginBottom: '10px',
                    color:        '#555555',
                }}>
                    First steps:
                </div>
                <ul class='ui list' style={{ margin: 0 }}>
                    <li style={{ marginBottom: '8px' }}>
                        <a
                            href    = '#'
                            onClick = { this.handle_load_examples }
                        >
                            Load example images
                        </a>
                    </li>
                    <li>
                        Load your own images by dropping them into the browser
                        window or{' '}
                        <a
                            href    = '#'
                            onClick = { this.handle_open_file_dialog }
                        >
                            clicking here
                        </a>
                    </li>
                </ul>
            </div>

            <input
                ref      = { this.file_input_ref }
                type     = 'file'
                style    = 'display:none'
                accept   = { props.input_filetypes.join(',') }
                multiple = { true }
                onChange = { this.handle_file_input_change }
            />
        </div>
    }

    handle_load_examples = 
    (event: JSX.TargetedMouseEvent<HTMLAnchorElement>): void => {
        event.preventDefault()
        this.props.on_load_examples?.()
    }

    handle_open_file_dialog = 
    (event: JSX.TargetedMouseEvent<HTMLAnchorElement>): void => {
        event.preventDefault()
        this.file_input_ref.current?.click()
    }

    handle_file_input_change = 
    async (event: JSX.TargetedEvent<HTMLInputElement>): Promise<void> => {
        const input: HTMLInputElement = event.currentTarget
        const files: FileList | File[] = input.files ?? []
        await this.props.on_new_files(files)
        input.value = ''
    }
}
