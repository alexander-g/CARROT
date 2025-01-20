import { base, JSX } from "../dep.ts"
import { CARROT_State }  from "./state.ts"
import { CARROT_Result } from "../lib/carrot_detection.ts"


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
    override result_overlays(): JSX.Element {
        
        return <>
            <base.imageoverlay.ImageOverlay 
                image     = {this.props.$result.value.classmap}        
                $visible  = {this.$result_visible}
            />
        </>
    }
}

