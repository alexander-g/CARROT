
WoodAnatomyApp = class extends BaseApp {
    static Settings      =    WoodSettings;
    static FileInput     =    WoodFileInput;
    static Detection     =    WoodDetection;
    static Editing       =    WoodEditing;
    static Training      =    WoodTraining;
    static Download      =    WoodDownload;
}


//override
App = WoodAnatomyApp;
