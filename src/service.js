const vscode = require('vscode')
const {workspace, window, ProgressLocation, commands} = vscode
const {showErrorMessage, withProgress} = window
const path = require('path')
const fs = require('fs')
const beautify = require('json-beautify')
const walker = require('walker')
const events = require('./bus')
const os = require('os')
const cp = require('child_process')

class Service {
    constructor() {
        console.log('-----------------------------------------')
        this.rootPath = ''
        this.ideaPath = ''
        this.config = {}
        this.init()
    }

    get map() {
        return this.config.map || {}
    }
    
    async init() {
        const {workspaceFolders} = workspace
        if (!workspaceFolders || !workspaceFolders.length) {
            return
        }
		const {uri: {fsPath}} = workspaceFolders[0]
        this.rootPath = fsPath
        this.ideaPath = path.join(this.ideaRoot, 'config.json')
        if (fs.existsSync(this.ideaPath)) {
            await this.loadIdea()
            if (!Object.keys(this.config).length) {
                showErrorMessage('配置文件有误')
            }
            if (this.config.enable) {
                this.startIndexing()
            }
        }
    }

    toggleEnable() {
        this.config.enable = !this.config.enable
        return this.writeIdea()
    }

    get ideaRoot() {
        const ideaRoot = path.join(this.rootPath, '.miniprogram-util-idea')
        if (!fs.existsSync(ideaRoot)) {
			const command = `${os.platform() === 'win32' ? 'md' : 'mkdir -p'} ${ideaRoot}`
			console.log(command)
            cp.execSync(command)
            if (!fs.statSync(ideaRoot).isDirectory()) {
                showErrorMessage('索引文件生成失败')
            }
        }
        
        return ideaRoot
    }

    /**
     * 开始建立索引
     * @returns {Thenable}
     */
	startIndexing() {
        return withProgress({
            location: ProgressLocation.Notification,
            title: 'Indexing...',
            cancellable: false
        }, async (progress) => {
            try {
                await this.loadDirs(progress, 20)
                await this.loadIdea(progress, 80)
                //自定义命令，显示右键菜单
                await commands.executeCommand('setContext', 'mpu:ready', true)
                //提交事件，加载左侧视图
                events.emit('mpu:ready', this)
            } catch (e) {
                showErrorMessage(e)
            }
            return Promise.resolve()
        })
    }

    /**
     * 载入目录列表到内存
     * @returns {Promise}
     */
    loadDirs(progress, end = 100) {
        let offset = 0, ts = 250, step = Math.floor(end / (1000 / ts))
        clearInterval(this.fakeTimer)
        this.fakeTimer = setInterval(() => {
            offset += step
            if (offset >= end) {
                clearInterval(this.fakeTimer)
            } else {
                progress && progress.report({ increment: step })
            }
        }, ts)

        this.dirList = []
        return new Promise((resolve, reject) => {
            walker(this.rootPath)
                .filterDir((dir) => {
                    //去掉.开头的文件夹
                    const reg = new RegExp(`\\${path.sep}\\.`, 'g')
                    if (reg.test(dir)) {
                        console.log('Got filter: ' + dir)
                        return false
                    }
                    //只获取工作区下的一级目录
                    if (dir.replace(this.rootPath).lastIndexOf(path.sep) !== -1) {
                        this.dirList.push(dir.replace(this.rootPath + path.sep, ''))
                        return false
                    }
                    return true
                })
                .on('error', function(err, entry) {
                    console.log('Got error ' + err + ' on entry ' + entry)
                    clearInterval(this.fakeTimer)
                    reject(err)
                })
                .on('end', function() {
                    console.log('All files traversed.')
                    clearInterval(this.fakeTimer)
                    events.emit('mpu:loadDirs:complete', this.dirList, this)
                    resolve()
                })
        })
    }

    /**
     * 载入idea到内存
     * @returns {Promise}
     */
    loadIdea(progress, end = 100) {
        return new Promise((resolve) => {
            if (!fs.existsSync(this.ideaPath)) {
                resolve()
            } else {
                const stats = fs.statSync(this.ideaPath)
                const readStream = fs.createReadStream(this.ideaPath)
                let totalSize = stats.size
                let curSize = 0
                let content = ''
                readStream.on('data', ( chunk ) => { 
                    curSize += chunk.length
                    progress && progress.report({ increment: Math.ceil(curSize / totalSize * end) })
                    content += chunk
                })
                readStream.on('end', () => {
                    try {
                        this.config = JSON.parse(content)
                    } catch (e) {
                        this.config = {}
                    }
                    events.emit('mpu:loadIdea:complete', this.config, this)
                    resolve()
                })
            }
        })
    }

    /**
     * 写入索引文件
     * @returns {Promise}
     */
    writeIdea(progress, end = 100) {
        return new Promise((resolve, reject) => {
            try {
                fs.writeFileSync(this.ideaPath, beautify(this.config, null, 2, 2))
                resolve()
            } catch (e) {
                console.log(e)
                reject('索引文件写入失败')
            }
            progress && progress.report({ increment: end })
            events.emit('mpu:writeIdea:complete', this.ideaPath, this)
        })
    }

    /**
     * 获取模板下的项目
     * @param {String} name 模板文件夹名称
     * @returns {Set}
     */
    getProjects(name) {
        return new Set(Array.isArray(this.map[name]) ? this.map[name] : [])
    }

    /**
     * 获取当前工作区下的所有项目
     * @returns {Set}
     */
    getAllProjects() {
        return new Set(Object.keys(this.map).reduce((p, name) => [...p, ...this.getProjects(name)], []))
    }

    /**
     * 判断文件夹是否为项目
     * @param {String} name 
     * @returns {Boolean}
     */
    isProject(name) {
        return this.getAllProjects().has(name)
    }

    /**
     * 通过项目名称获取对应的模板名称
     * @param {String} name 
     * @returns {Boolean}
     */
    getTemplate(name) {
        let founded = null
        for (let template in this.map) {
            if (this.map[template].includes(name)) {
                founded = template
                break
            }
        }
        return founded
    }

    /**
     * 获取当前工作区下的所有模板
     * @returns {Set}
     */
    getAllTemplates() {
        return new Set(Object.keys(this.map))
    }

    /**
     * 判断文件夹是否为模板
     * @param {String} name 
     * @returns {Boolean}
     */
    isTemplate(name) {
        return this.getAllTemplates().has(name)
    }

    /**
     * 判断文件夹没有标记过
     * @param {String} name 
     * @returns {Promise}
     */
    isNeverMarked(name) {
        return new Promise((resolve, reject) => {
            if (this.isTemplate(name)) {
                reject(`${name}已经是模板`)
            } else if (this.isProject(name)) {
                reject(`${name}已经是项目`)
            } else {
                resolve()
            }
        })
    }

    /**
     * 设置文件夹为项目
     * @param {String} name 
     * @returns {Promise}
     */
    markAsProject(name, template) {
        const projects = this.getProjects(template).add(name)
        const map = {...this.map, [template]: Array.from(projects)}
        for (let t in map) {
            if (t != template && map[t].includes(name)) {
                const set = new Set(map[t])
                set.delete(name)
                map[t] = [...set]
            }
        }
        this.config.map = map
        return this.writeIdea()
    }

    /**
     * 取消设置文件夹为项目
     * @param {String} name 
     * @returns {Promise} 
     */
    cancelProject(name) {
        const map = {...this.map}
        const template = this.getTemplate(name)
        const set = new Set(map[template])
        set.delete(name)
        map[template] = [...set]
        this.config.map = map
        return this.writeIdea()
    }

    /**
     * 设置文件夹为模板
     * @param {String} name 
     * @returns {Promise}
     */
    markAsTemplate(name) {
        const map = {...this.map, [name]: []}
        this.config.map = map
        return this.writeIdea()
    }

    /**
     * 取消设置文件夹为模板
     * @param {String} name 
     * @returns {Promise} 
     */
    cancelTemplate(name) {
        const map = {...this.map}
        delete map[name]
        this.config.map = map
        return this.writeIdea()
    }
}

module.exports = new Service()