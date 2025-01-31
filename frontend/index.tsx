import { base, JSX } from "./dep.ts"

import { CARROT_State } from "./components/state.ts";
import { CARROT_DetectionTab } from "./components/DetectionTab.tsx";
import { CARROT_SettingsHandler } from "./lib/carrot_settings.ts";
import { 
    CARROT_RemoteBackend, 
    CARROT_Result, 
    is_CARROT_Backend,
} from "./lib/carrot_detection.ts";


const id = "CARROT";



class CARROT_App extends base.create_App({
    id:id,
    AppState:        CARROT_State,
    // @ts-ignore type hell
    backend:         CARROT_RemoteBackend,
    settingshandler: new CARROT_SettingsHandler,
    TopMenu:         base.TopMenu,
    tabs:{
        'Detection': CARROT_DetectionTab,
    },
}){
    // overriding to pass processingmodule to appstate.set_files
    override async on_new_files(files: FileList | File[]): Promise<void> {
        const backend = 
            new this.backend(CARROT_Result, this.appstate.$settings.value!)
        
        if(is_CARROT_Backend(backend)){
            return await this.appstate.set_files(files, backend)
        }
        // else
        return await this.appstate.set_files(files)
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
