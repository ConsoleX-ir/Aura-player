export namespace library {
	
	export class AudioFile {
	    path: string;
	    name: string;
	    mtimeMs: number;
	
	    static createFrom(source: any = {}) {
	        return new AudioFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.mtimeMs = source["mtimeMs"];
	    }
	}
	export class PathCheck {
	    path: string;
	    exists: boolean;
	    sizeBytes: number;
	    mtimeMs: number;
	
	    static createFrom(source: any = {}) {
	        return new PathCheck(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.exists = source["exists"];
	        this.sizeBytes = source["sizeBytes"];
	        this.mtimeMs = source["mtimeMs"];
	    }
	}
	export class Resolved {
	    files: AudioFile[];
	    folders: string[];
	
	    static createFrom(source: any = {}) {
	        return new Resolved(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.files = this.convertValues(source["files"], AudioFile);
	        this.folders = source["folders"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace metadata {
	
	export class FileStats {
	    sizeBytes: number;
	    extension: string;
	    bitrateKbps?: number;
	    sampleRateHz?: number;
	    channels?: number;
	    codec?: string;
	    container?: string;
	
	    static createFrom(source: any = {}) {
	        return new FileStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sizeBytes = source["sizeBytes"];
	        this.extension = source["extension"];
	        this.bitrateKbps = source["bitrateKbps"];
	        this.sampleRateHz = source["sampleRateHz"];
	        this.channels = source["channels"];
	        this.codec = source["codec"];
	        this.container = source["container"];
	    }
	}
	export class Meta {
	    title: string;
	    artist: string;
	    album: string;
	    duration: number;
	    year?: number;
	    genre?: string;
	    trackNumber?: number;
	    coverArt?: string;
	
	    static createFrom(source: any = {}) {
	        return new Meta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.artist = source["artist"];
	        this.album = source["album"];
	        this.duration = source["duration"];
	        this.year = source["year"];
	        this.genre = source["genre"];
	        this.trackNumber = source["trackNumber"];
	        this.coverArt = source["coverArt"];
	    }
	}

}

export namespace netcore {
	
	export class ProbeResult {
	    ok: boolean;
	    kind: string;
	    detail?: string;
	    latencyMs: number;
	
	    static createFrom(source: any = {}) {
	        return new ProbeResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.kind = source["kind"];
	        this.detail = source["detail"];
	        this.latencyMs = source["latencyMs"];
	    }
	}

}

export namespace providers {
	
	export class FindQuery {
	    title: string;
	    artist: string;
	    album: string;
	    duration: number;
	
	    static createFrom(source: any = {}) {
	        return new FindQuery(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.artist = source["artist"];
	        this.album = source["album"];
	        this.duration = source["duration"];
	    }
	}

}

export namespace shell {
	
	export class DefaultAppsResult {
	    ok: boolean;
	    openedSettings?: boolean;
	    reason?: string;
	
	    static createFrom(source: any = {}) {
	        return new DefaultAppsResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.openedSettings = source["openedSettings"];
	        this.reason = source["reason"];
	    }
	}

}

