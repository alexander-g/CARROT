import { 
    estimate_years_for_new_treerings_from_old_ones,
    type PointPair,
    type TreeringInfo,
} from "../../frontend/lib/treering_utils.ts";

import { asserts } from "./dep.ts";



Deno.test('estimate_years', () => {
    const new_rings0: PointPair[][] = [
        [
            [{x: 100, y:100}, {x: 200, y:100}],
            [{x: 100, y:200}, {x: 200, y:200}],
            [{x: 100, y:300}, {x: 200, y:300}],
            [{x: 100, y:400}, {x: 200, y:400}],
        ], 
        [
            [{x: 200, y:100}, {x: 300, y:100}],
            [{x: 200, y:200}, {x: 300, y:200}],
            [{x: 200, y:300}, {x: 300, y:300}],
            [{x: 200, y:400}, {x: 300, y:400}],
        ],
        [
            [{x: 300, y:100}, {x: 400, y:100}],
            [{x: 300, y:200}, {x: 400, y:200}],
            [{x: 300, y:300}, {x: 400, y:300}],
            [{x: 300, y:400}, {x: 400, y:400}],
        ], 
    ]

    const old_rings0: TreeringInfo[] = [
        {
            year: 2014,
            coordinates: [
                [{x: 10, y:100}, {x: 110, y:100}],
                [{x: 10, y:250}, {x: 110, y:250}],
                [{x: 10, y:410}, {x: 110, y:410}],
            ]
        },
        {
            year: 2013,
            coordinates: [
                [{x: 110, y:100}, {x: 210, y:100}],
                [{x: 110, y:250}, {x: 210, y:250}],
                [{x: 110, y:400}, {x: 210, y:400}],
            ]
        },
        {
            year: 2012,
            coordinates: [
                [{x: 210, y:100}, {x: 310, y:100}],
                [{x: 210, y:250}, {x: 310, y:250}],
                [{x: 210, y:410}, {x: 310, y:410}],
            ]
        },
        {
            year: 2011,
            coordinates: [
                [{x: 310, y:100}, {x: 410, y:100}],
                [{x: 310, y:250}, {x: 410, y:250}],
                [{x: 310, y:400}, {x: 410, y:400}],
            ]
        },
    ]

    const output0 = estimate_years_for_new_treerings_from_old_ones(new_rings0, old_rings0, 'ascending')
    asserts.assertEquals(output0, [2013, 2014, 2015])

    const output1 = estimate_years_for_new_treerings_from_old_ones(new_rings0, old_rings0, 'descending')
    asserts.assertEquals(output1, [2013, 2012, 2011])
})



