
WoodAnatomyApp = class extends BaseApp {
    static Settings      =    WoodSettings;
    static FileInput     =    WoodFileInput;
    static Detection     =    WoodDetection;
    static Editing       =    WoodEditing;
    static Training      =    WoodTraining;
    static Download      =    WoodDownload;
}


//override (both needed)
App        = WoodAnatomyApp;
GLOBAL.App = WoodAnatomyApp;


//override (mostly just for documentation)
class WoodInputFile extends InputFile {
    cell_results     = undefined;
    treering_results = undefined;
}
