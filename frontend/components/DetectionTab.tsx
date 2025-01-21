import { base, Signal, signals, JSX } from "../dep.ts"
import { CARROT_State }  from "./state.ts"
import { CARROT_Result } from "../lib/carrot_detection.ts"
import { TreeringsSVGOverlay, PointPair } from "./TreeringsSVGOverlay.tsx"


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

    $treering_points: Readonly<Signal<PointPair[][]>> = signals.computed( () => { 
        return this.props.$result.value.get_treering_coordinates_if_loaded() ?? [] 
    }
    )

    override result_overlays(): JSX.Element {
        
        return <>
            <base.imageoverlay.ImageOverlay 
                image     = {this.props.$result.value.classmap}        
                $visible  = {this.$result_visible}
            />
            <TreeringsSVGOverlay 
                size = { this.$imagesize.value ?? {height:0, width:0} }
                $treering_points = { this.$treering_points }
            />
        </>
    }
}

