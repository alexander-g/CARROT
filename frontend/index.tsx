import { base, JSX } from "./dep.ts"

import { CARROT_State } from "./components/state.ts";
import { CARROT_DetectionTab } from "./components/DetectionTab.tsx";
import { CARROT_SettingsHandler, CARROT_WebSettingsHandler } from "./lib/carrot_settings.ts";
import { 
    CARROT_Backend,
    CARROT_RemoteBackend, 
    CARROT_Result, 
    is_CARROT_Backend,
} from "./lib/carrot_detection.ts";
import { CARROT_SettingsModal } from "./components/CARROT_Settings.tsx";
import { TrainingTab, TrainingNotAvailableTab } from "./components/TrainingTab.tsx"

import { CARROT_ONNXBackend } from './lib/onnx_carrot.ts'


const id = "CARROT";


/** Config set during build */
export type AppConfig = null | {
    mode: 'desktop'|'web'
    
    
}



declare global {
    interface Window {
        /** App config is set during build in a <script> inside <Head> */
        app_config: AppConfig;
    }
}


const CARROT_DesktopBaseApp = base.create_App({
    id:id,
    AppState:        CARROT_State,
    // @ts-ignore type hell
    backend:         CARROT_RemoteBackend,
    settingshandler: new CARROT_SettingsHandler,
    SettingsModal:   CARROT_SettingsModal,
    tabs:{
        'Detection': CARROT_DetectionTab,
        'Training':  TrainingTab,
    },
})

const CARROT_WebBaseApp = base.create_App({
    id:id,
    AppState:        CARROT_State,
    // @ts-ignore type hell
    backend:         CARROT_ONNXBackend,
    settingshandler: new CARROT_WebSettingsHandler,
    SettingsModal:   CARROT_SettingsModal,
    tabs:{
        'Detection': CARROT_DetectionTab,
        'Training':  TrainingNotAvailableTab,
    },
})

function WithOverrides(Base:typeof CARROT_DesktopBaseApp|typeof CARROT_WebBaseApp) {
    return class CARROT_App extends Base {
        // overriding to pass processingmodule to appstate.set_files + more
        override async on_new_files(files: FileList | File[]): Promise<boolean> {
            const backend = 
                new this.backend(CARROT_Result, this.appstate.$settings.value!)




            // should be always the case, just to make typescript happy
            const carrotbackend:CARROT_Backend|undefined = 
                is_CARROT_Backend(backend)? backend : undefined;
            const changed:boolean = await this.appstate.set_files(files, carrotbackend)

            if(changed && this.appstate.$files.value.length > 0)
                this.settings_modal.current!.show_modal(/*cancel_ok=*/false)
            
            return changed;
        }

        override TopMenuClass = TopMenuWithLargerLogo;
    }
}


class CARROT_DesktopApp extends WithOverrides(CARROT_DesktopBaseApp){}
class CARROT_WebApp     extends WithOverrides(CARROT_WebBaseApp){}



class TopMenuWithLargerLogo extends base.TopMenu {
    override render(): JSX.Element {
        return <base.TopMenu 
            {...this.props}
            logo_width = {150}
        />
    }
}



function AppForActiveConfig(props:{config?:AppConfig}): JSX.Element{
    const config:AppConfig = props.config ?? self.app_config
    return (config?.mode == 'web')? <CARROT_WebApp/> : <CARROT_DesktopApp/>
}


/** Main JSX entry point */
export function Index(config?:AppConfig): JSX.Element {
    const configjson:string = JSON.stringify(config).replace(/</g, "\\u003c");
    return <html>
        <base.Head 
            title = "CARROT - Cell and Ring Recognition Tool" 
            import_src = "index.tsx.js" 
        >
            <link rel="icon" href="favicon.ico" />
            <link rel="stylesheet" href="css/treerings.css" />
            <script dangerouslySetInnerHTML={ {
                __html: `window.app_config = ${ configjson }`
            } } />
        </base.Head>
        <AppForActiveConfig config={config}/>
    </html>
}



if(!globalThis.Deno){
    base.hydrate_body(<AppForActiveConfig />, id)
}
