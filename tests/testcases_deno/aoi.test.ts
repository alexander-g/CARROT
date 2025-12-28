import { asserts } from "./dep.ts";

import { 
    rect_from_2points_and_width ,
    mirror_distance_perp,
    AoIRect,
    Point,
} from "../../frontend/components/TreeringsSVGOverlay.tsx"


// Deno.test("rect_from_2points_and_width - horizontal line", () => {
//     const p0: Point = { x: 0, y: 0 };
//     const p1: Point = { x: 10, y: 0 };
//     const rect = rect_from_2points_and_width(p0, p1, 4);
//     const expected: AoIRect = [
//         { x: 0, y: -2 },
//         { x: 10, y: -2 },
//         { x: 10, y: 2 },
//         { x: 0, y: 2 },
//     ];
//     asserts.assertEquals(rect, expected);
// });

// Deno.test("rect_from_2points_and_width - vertical line", () => {
//     const p0: Point = { x: 5, y: 5 };
//     const p1: Point = { x: 5, y: 15 };
//     const rect = rect_from_2points_and_width(p0, p1, 6);
//     const expected: AoIRect = [
//         { x: 8, y: 5 },
//         { x: 8, y: 15 },
//         { x: 2, y: 15 },
//         { x: 2, y: 5 },
//     ];
//     asserts.assertEquals(rect, expected);
// });

// Deno.test("rect_from_2points_and_width - zero length", () => {
//     const p0: Point = { x: 1, y: 1 };
//     const rect = rect_from_2points_and_width(p0, p0, 4);
//     const expected: AoIRect = [
//         { x: -1, y: -1 },
//         { x: 3, y: -1 },
//         { x: 3, y: 3 },
//         { x: -1, y: 3 },
//     ];
//     asserts.assertEquals(rect, expected);
// });


Deno.test("mirror_distance_perp", () => {
    const p1 = { x: 0, y: 0 };
    const p2 = { x: 1, y: 0 };
    const p3_0 = { x: 0, y: 2 };
    const p3_1 = { x: 0, y: -2 };
    
    const out0 = mirror_distance_perp(p1, p2, p3_0); 
    asserts.assertEquals(out0, { x: 1, y: 2 });

    const out1 = mirror_distance_perp(p1, p2, p3_1); 
    asserts.assertEquals(out1, { x: 1, y: -2 });
})

