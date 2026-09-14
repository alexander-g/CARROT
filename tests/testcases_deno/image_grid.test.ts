import { grid_for_overlapping_patches } from "../../frontend/lib/image_grid.ts"

import { asserts } from "./dep.ts"




Deno.test("grid_for_overlapping_patches: image is smaller than patch", () => {
    asserts.assertEquals(
        grid_for_overlapping_patches({height:50, width:60}, 100, 20),
        [
            [
                [0, 0, 50, 60],
            ],
        ],
    );
});

Deno.test("grid_for_overlapping_patches: exactly one patchsized image", () => {
    asserts.assertEquals(
        grid_for_overlapping_patches({height:100, width:100}, 100, 33),
        [
            [
                [0, 0, 100, 100],
            ],
        ],
    );
});

Deno.test("grid_for_overlapping_patches: image not divisible by patchsize", () => {
    asserts.assertEquals(
        grid_for_overlapping_patches({height:250, width:250}, 100, 0),
        [
            [
                [0, 0, 100, 100],
                [0, 100, 100, 200],
                [0, 150, 100, 250],
            ],
            [
                [100, 0, 200, 100],
                [100, 100, 200, 200],
                [100, 150, 200, 250],
            ],
            [
                [150, 0, 250, 100],
                [150, 100, 250, 200],
                [150, 150, 250, 250],
            ],
        ],
    );
});

Deno.test("grid_for_overlapping_patches: overlapping patches with slack", () => {
    // patchSize = 100, slack = 20
    // stepSize = 80
    asserts.assertEquals(
        grid_for_overlapping_patches({height:200, width:200}, 100, 20),
        [
            [
                [0, 0, 100, 100],
                [0, 80, 100, 180],
                [0, 100, 100, 200],
            ],
            [
                [80, 0, 180, 100],
                [80, 80, 180, 180],
                [80, 100, 180, 200],
            ],
            [
                [100, 0, 200, 100],
                [100, 80, 200, 180],
                [100, 100, 200, 200],
            ],
        ],
    );
});

Deno.test("grid_for_overlapping_patches: large slack", () => {
    asserts.assertEquals(
        grid_for_overlapping_patches({height:120, width:120}, 100, 90),
        [
            [
                [0, 0, 100, 100],
                [0, 10, 100, 110],
                [0, 20, 100, 120],
            ],
            [
                [10, 0, 110, 100],
                [10, 10, 110, 110],
                [10, 20, 110, 120],
            ],
            [
                [20, 0, 120, 100],
                [20, 10, 120, 110],
                [20, 20, 120, 120],
            ],
        ],
    );
});

Deno.test("grid_for_overlapping_patches: zero height", () => {
    asserts.assertEquals(
        grid_for_overlapping_patches({height:0, width:100}, 50, 10),
        [],
    );
});

Deno.test("grid_for_overlapping_patches: zero width", () => {
    asserts.assertEquals(
        grid_for_overlapping_patches({height:100, width:0}, 50, 10),
        [
            [],
            [],
            []
        ],
    );
});
