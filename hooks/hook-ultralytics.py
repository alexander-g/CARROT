# hooks/hook-ultralytics.py
import os

ultralytics_root = \
    os.path.join(os.path.dirname(__file__), '../carrot_ml/vendor/ultralytics/ultralytics')

hiddenimports = []
binaries = []
datas = [
    (ultralytics_root, 'ultralytics'),
    
]
