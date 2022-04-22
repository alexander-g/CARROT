from base.backend.pubsub import PubSub

import threading, pickle, os
import numpy as np
import PIL.Image

#TODO: unify
class GLOBALS:
    processing_lock     = threading.Lock()

def write_image(path, x):
    if np.max(x) <= 1.0:
        x = x*255
    x = x.astype('uint8')
    x = PIL.Image.fromarray(x).convert('RGB')
    x.save(path)


def process_cells(image_path, settings):
    model = settings.models['cells']
    x     = model.load_image(image_path)
    with GLOBALS.processing_lock:
        print(f'Processing file {image_path} with model {settings.active_models["cells"]}')
        def on_progress(p):
            PubSub.publish({'progress':p, 'image':os.path.basename(image_path), 'stage':'cells'})
        y = model.process_image(x, progress_callback=on_progress)
    output_path = image_path+'.cells.png'
    write_image(output_path, y)
    return output_path


def process_treerings(image_path, settings):
    model = settings.models['treerings']
    with GLOBALS.processing_lock:
        print(f'Processing file {image_path} with model {settings.active_models["cells"]}')
        x = model.load_image(image_path)
        def on_progress(p):
            PubSub.publish({'progress':p, 'image':os.path.basename(image_path), 'stage':'treerings'})
        y = model.process_image(x, progress_callback=on_progress)
    output_path = image_path+'.treerings.png'
    write_image(output_path, y['segmentation']>0)
    open(image_path+'.ring_points.pkl','wb').write(pickle.dumps(y['ring_points']))
    
    return {
        'segmentation': output_path,
        'ring_points' : [np.stack([sample_points(a, 64), sample_points(b, 64)], axis=1) for a,b in y['ring_points']],  #TODO
    }

def sample_points(points, n):
    '''Select n points'''
    return np.array(points)[ np.linspace(0,len(points)-1,n).astype(int) ]


def associate_cells(image_path, settings, recluster=False):
    '''Assign a tree ring label to each cell'''
    model = settings.models['treerings']
    print(f'Processing file {image_path} with model {settings.active_models["treerings"]}')
    
    if recluster:
        treering_segmentation  = PIL.Image.open(image_path+'.treerings.png').convert('L') / np.float32(255)
        ring_points            = model.segmentation_to_points(treering_segmentation)['ring_points']
    else:
        ring_points            = pickle.load(open(image_path+'.ring_points.pkl','rb'))

    cell_path   = image_path+'.cells.png'
    if os.path.exists(cell_path):
        cell_map            = PIL.Image.open(cell_path).convert('L') / np.float32(255)
        cells, ring_map_rgb = model.associate_cells_from_segmentation(cell_map, ring_points)
        ring_map_output     = image_path+'.ring_map.png'
        write_image(ring_map_output, ring_map_rgb)
    else:
        ring_map_output     = ''
        cells               = []
    
    return {
        'ring_map'    : ring_map_output,
        'cells'       : cells,
        'ring_points' : [np.stack([sample_points(a, 64), sample_points(b, 64)], axis=1) for a,b in ring_points ],  #TODO
    }
