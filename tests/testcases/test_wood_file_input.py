import os
BaseCase = __import__('base_case').BaseCase

import pytest
import tempfile
import numpy as np, PIL.Image
            

class TestWoodFileInput(BaseCase):
    def test_cell_results(self):
        self.open_main(static=False)
        #open image files and a result file
        filenames = [ 
            "ELD_QURO_635A_3_crop.jpg", "ELD_QURO_635A_3_crop.jpg.cells.png",
        ]
        self.send_input_files_from_assets(filenames)
        self.sleep(1)

        #row label should be bold to indicate that this file is processed
        script = f''' return $('[filename="{filenames[0]}"] label').css('font-weight') '''
        assert int(self.execute_script(script)) > 500

        self.assert_no_js_errors()

        if self.demo_mode:
            self.sleep(1)

    def test_treering_results(self):
        self.open_main(static=False)
        #open image files and a result file
        filenames = [ 
            "ELD_QURO_635A_3_crop.jpg", "ELD_QURO_635A_3_crop.jpg.treerings.png",
        ]
        self.send_input_files_from_assets(filenames)
        self.sleep(4)

        #row label should be bold to indicate that this file is processed
        script = f''' return $('[filename="{filenames[0]}"] label').css('font-weight') '''
        assert int(self.execute_script(script)) > 500

        self.assert_no_js_errors()

        if self.demo_mode:
            self.sleep(1)


