import { base, JSX } from "./dep.ts"

import { CARROT_State } from "./components/state.ts";
import { CARROT_DetectionTab } from "./components/DetectionTab.tsx";
import { CARROT_SettingsHandler } from "./lib/carrot_settings.ts";
import { 
    CARROT_Backend,
    CARROT_RemoteBackend, 
    CARROT_Result, 
    is_CARROT_Backend,
} from "./lib/carrot_detection.ts";
import { CARROT_SettingsModal } from "./components/CARROT_Settings.tsx";
import { TrainingTab }    from "./components/TrainingTab.tsx"


const id = "CARROT";



class CARROT_App extends base.create_App({
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
}){
    // overriding to pass processingmodule to appstate.set_files + more
    override async on_new_files(files: FileList | File[]): Promise<void> {
        const backend = 
            new this.backend(CARROT_Result, this.appstate.$settings.value!)




        // should be always the case, just to make typescript happy
        const carrotbackend:CARROT_Backend|undefined = 
            is_CARROT_Backend(backend)? backend : undefined;
        const changed:boolean = await this.appstate.set_files(files, carrotbackend)

        if(changed && this.appstate.$files.value.length > 0)
            this.settings_modal.current!.show_modal(/*cancel_ok=*/false)
    }
}


export function Index(): JSX.Element {
    return <html>
        <base.Head 
            title = {"CARROT - Cell and Ring Recognition Tool"} 
            import_src = {"index.tsx.js"} 
        >
            <link rel="icon" href="favicon.ico" />
            <link rel="stylesheet" href="css/treerings.css" />
        </base.Head>
        <CARROT_App />
    </html>
}



if(!globalThis.Deno){
    base.hydrate_body(<CARROT_App />, id)
}
