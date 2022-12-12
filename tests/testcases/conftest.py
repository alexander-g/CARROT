import os
os.environ['TESTS_TO_SKIP'] = (
    '''test_download_all'''                 #replaced by TestWoodDownload.test_download_all
    '''test_load_results'''                 #requires non-static, replaced with test_wood_file_input.py
    '''test_overlay_side_by_side_switch'''  #side-by-side disabled in this ui
    '''test_add_boxes'''                    #no boxes
)


from tests.mockmodels import cells_model, treerings_model
from base.backend.app import get_models_path

models_path = os.path.join(get_models_path(), 'cells')
os.makedirs(models_path, exist_ok=True)
for i in range(3):
    cells_model.CellsMockModel().save( os.path.join(models_path, f'model_{i}') )

models_path = os.path.join(get_models_path(), 'treerings')
os.makedirs(models_path, exist_ok=True)
for i in range(3):
    treerings_model.TreeringsMockModel().save( os.path.join(models_path, f'model_{i}') )
