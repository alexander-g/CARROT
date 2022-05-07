import os, subprocess
BaseCase = __import__('base_case').BaseCase



class TestWoodDownload(BaseCase):
    def test_download_all(self):
        if not self.is_chromium() and not self.headed:
            self.skipTest('xdotool does not work with headless firefox for some reason')
        self.open_main(static=False)

        filenames = [ 
            "ELD_QURO_635A_3_crop.jpg", "ELD_QURO_635A_3_crop.jpg.cells.png", "ELD_QURO_635A_3_crop.jpg.treerings.png",
        ]
        self.send_input_files_from_assets(filenames)
        
        self.click('[data-tab="detection"] .download-all')
        #send enter key to x11 to confirm the download dialog window
        if not self.is_chromium():  #self.is_firefox()
            self.sleep(1.0)
            subprocess.call('xdotool key Return', shell=True)

        self.sleep(1.0)
        self.assert_downloaded_file('results.zip')
        self.assert_no_js_errors()
        
        #TODO: assert downloaded results are the same as what was uploaded
        import zipfile
        zipf = zipfile.ZipFile(self.get_path_of_downloaded_file('results.zip'))
        contents = zipf.namelist()
        print(contents)
        assert "ELD_QURO_635A_3_crop.jpg/ELD_QURO_635A_3_crop.jpg.cells.png" in contents
        assert "ELD_QURO_635A_3_crop.jpg/ELD_QURO_635A_3_crop.jpg.treerings.png" in contents

        if self.demo_mode:
            self.sleep(1)
