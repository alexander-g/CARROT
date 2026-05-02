import { base } from "../dep.ts"
import type { TreeringInfo } from "./carrot_detection.ts"



export type Point      = base.util.Point;
export type PointPair  = [Point,Point]
export { TreeringInfo} ;


/** Estimate how similar newly computed treerings are to the old ones, then
 *  estimates years for them, based on the previous ones */
export function estimate_years_for_new_treerings_from_old_ones(
    new_rings: PointPair[][], 
    old_rings: TreeringInfo[], 
    order:     'ascending'|'descending'
): number[] {
    if(new_rings.length == 0)
        return []
    if(old_rings.length == 0) {
        const indices: number[] = base.util.arange(1, new_rings.length+1)
        
        return (order == 'ascending')? indices : indices.reverse()
    }

    const old_ring_coordinates: PointPair[][] = 
        old_rings.map( info => info.coordinates )
    const distances: number[][] = 
        treering_disance_matrix(new_rings, old_ring_coordinates)
    
    // should not be null
    const [i,j] = matrix_argmin(distances)!

    // the year that should be at position i in the new years
    const year_at_i: number = old_rings[j]!.year
    const earliest_year: number = 
        (order == 'ascending')
        ? year_at_i - i 
        : year_at_i + i - new_rings.length + 1;

    const new_years: number[] = base.util.arange(earliest_year, earliest_year+new_rings.length)
    return (order == 'ascending') ? new_years : new_years.reverse()
}

/** Create a `[N x M]` matrix, estimating how dissimilar all rings are */
function treering_disance_matrix(rings0: PointPair[][], rings1: PointPair[][]): number[][] {
    const N: number = rings0.length
    const M: number = rings1.length

    const matrix: number[][] = NaN_matrix(N,M);
    for(let i: number = 0; i < N; i++)
        for(let j: number = 0; j < M; j++)
            matrix[i]![j] = treering_distance(rings0[i]!, rings1[j]!)
    
    return matrix;
}



/** Quick estimate how dissimilar two treerings are */
function treering_distance(ring0: PointPair[], ring1: PointPair[]): number {
    const ring0_border0: Point[] = ring0.map( ([p0,_]) => p0 );
    const ring0_border1: Point[] = ring0.map( ([_,p1]) => p1 );
    const ring1_border0: Point[] = ring1.map( ([p0,_]) => p0 );
    const ring1_border1: Point[] = ring1.map( ([_,p1]) => p1 );

    const d0: number = estimate_path_to_path_distance(ring0_border0, ring1_border0)
    const d1: number = estimate_path_to_path_distance(ring0_border1, ring1_border1)
    return d0 + d1;
}

/** Quick estimate how dissimilar to paths are */
function estimate_path_to_path_distance(path0: Point[], path1: Point[]): number {
    const n0: number = path0.length;
    const n1: number = path1.length;
    if(n0 == 0 || n1 == 0)
        return Infinity;

    const d0: number = base.util.distance(path0[0]!,    path1[0]!)
    const d1: number = base.util.distance(path0[n0-1]!, path1[n1-1]!)

    return d0 + d1;
}


/** Find the `[i,j]` indices for the smallest value in a matrix */
function matrix_argmin(matrix: number[][]): [number, number]|null {
    if(matrix.flat().length == 0)
        return null;

    let minimum_value: number = Infinity;
    let minimum_indices: [number, number] = [-1, -1]
    for(let i: number = 0; i < matrix.length; i++)
        for(let j: number = 0; j < matrix[i]!.length; j++) {
            if(minimum_value > matrix[i]![j]!) {
                minimum_value = matrix[i]![j]!
                minimum_indices = [i, j]
            }
        }
    
    return minimum_indices;
}


/** Generate a `NxM` matrix filled with `NaN` */
function NaN_matrix(N:number, M:number): number[][] {
    return [...Array(N)].map( _ => Array(M).fill(NaN) )
}

