import { base } from '../dep.ts'


export type PatchBox = [y0: number, x0: number, y1: number, x1: number]
export type PatchGrid = PatchBox[][]


/** Generate coordinates for a grid of overlapping image patches. */
export function grid_for_overlapping_patches(
    imagesize:  base.util.Size,
    patchsize:  number,
    slack:      number,
): PatchGrid|Error {
    const {height:H, width:W} = imagesize;

    if(!Number.isInteger(H) || !Number.isInteger(W))
        return new RangeError('imagesize dimensions are not integers')
    if(H < 0 || W < 0)
        return new RangeError('imagesize negative')
    if(!Number.isInteger(patchsize) || patchsize <= 0)
        return new RangeError("patchsize not a positive integer")

    if(!Number.isInteger(slack) || slack < 0 || slack >= patchsize)
        return new RangeError(
            'slack not an integer within 0 <= slack < patchsize'
        )

    const stepsize:number = patchsize - slack;

    // arange(patchsize, H + stepsize, stepsize)
    const gridY: number[] = [];
    for (let y: number = patchsize; y < H + stepsize; y += stepsize)
        gridY.push(Math.min(y, H));

    const gridX: number[] = [];
    for (let x: number = patchsize; x < W + stepsize; x += stepsize)
        gridX.push(Math.min(x, W));


    const grid: PatchGrid = [];
    for(const y1 of gridY) {
        const row: PatchBox[] = [];

        for (const x1 of gridX) {
            const y0: number = Math.max(0, y1 - patchsize);
            const x0: number = Math.max(0, x1 - patchsize);

            row.push([y0, x0, y1, x1]);
        }
        grid.push(row);
    }
    return grid;
}









