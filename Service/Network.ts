import Http, { HttpRequest } from "../Network/Http";
import Wechat from "../Wechat/Wechat";
import SdkboxPlay from "../SDKBox/SdkboxPlay";
import { WebSock, WsRequest } from "../Network/WebSock";
import { isTTGame } from "../Utils";

export interface UserInfo {
	avatarUrl?: string;
	nickName: string;
}

class Network {
	private ws: WebSock;
	httpUrl: string;
	wsUrl: string;
	account: string;
	authorization: string;
	userInfo: UserInfo;
	appname: string;
	isGuest: boolean; // 游客模式
	isLocal: boolean; // 单机模式

	init(httpUrl: string, wsUrl?: string) {
		this.httpUrl = httpUrl;
		this.wsUrl = wsUrl;
		console.log("Network init:", this.httpUrl, this.wsUrl);
		if (cc.sys.isNative) {
			SdkboxPlay.init();
		}
		if (this.wsUrl) {
			this.ws = new WebSock(this.wsUrl);
		}
	}

	setHttpHost(host: string) {
		this.httpUrl = host;
	}

	getHttpHost() {
		return this.httpUrl;
	}

	private urlWithHost(req: HttpRequest) {
		const newReq: HttpRequest = {
			url: this.httpUrl + req.url,
			data: req.data,
			authorization: this.authorization,
		}
		return newReq;
	}

	async getGuestAccount() {
		var account = cc.sys.localStorage.getItem("GuestAccount");
		if (account) {
			return account;
		}
		const res = await this.asyncHttpPost({
			url: '/center/user/guest',
			defaultRes: '游客' + Math.random().toString(36).slice(-8),
		});
		account = res.acc;
		cc.sys.localStorage.setItem("GuestAccount", account);
		return account;
	}

	async login(appname?: string, account?: string) {
		this.appname = appname;
		return new Promise<any>((resolve, reject) => {
			const reqAuth = async () => {
				if (!this.account) {
					this.isGuest = true;
					this.account = await this.getGuestAccount();
				}
				var res = await this.asyncHttpPost({
					url: '/center/user/authorization',
					data: {
						acc: this.account
					},
				});
				if (!res) {
					console.log(`login fail, acc:${this.account}`);
					this.isLocal = true;
					resolve();
				}
				this.authorization = res.authorization;
				resolve(this.authorization);
				console.log(`login success, acc:${this.account}, authorization:${this.authorization}`);
			}
			if (cc.sys.platform == cc.sys.WECHAT_GAME) {
				wx.login({
					success: (res) => {
						if (res.code) {
							(async () => {
								var resp = await this.asyncHttpPost({
									url: '/center/wechat/openid',
									data: {
										jscode: res.code,
										appname: this.appname,
										tt: isTTGame(),
									}
								});
								this.account = resp.openid;
								reqAuth();
							})()
						} else {
							console.log('登录错误！' + res.errMsg)
							reqAuth();
						}
					},
					fail:(res) => {
						console.log('登录失败！' + res.errMsg)
						reqAuth();
					}
				})
			} else if (cc.sys.isNative) {
				(async () => {
					this.account = await SdkboxPlay.signin();
					reqAuth();
				})();
			} else {
				this.account = account || 'test';
				reqAuth();
			}
		});
	}

	async asyncHttpGet(req: HttpRequest) {
		console.log("Http async get", req);
		if (this.isLocal) {
			return req.defaultRes;
		}
		var res;
		const newReq = this.urlWithHost(req);
		if (cc.sys.platform == cc.sys.WECHAT_GAME) {
			res = await Wechat.asyncHttpGet(newReq);
		} else {
			res = await Http.asyncGet(newReq);
		}
		if (res.err == 4) {
			let authorization = await this.login();
			if (authorization) {
				return this.asyncHttpGet(req);
			} else {
				throw new Error("login fail");
			}
		}
		return res;
	}
	async asyncHttpPost(req: HttpRequest) {
		console.log("Http async post", req);
		if (this.isLocal) {
			return req.defaultRes;
		}
		var res;
		const newReq = this.urlWithHost(req);
		if (cc.sys.platform == cc.sys.WECHAT_GAME) {
			res = await Wechat.asyncHttpPost(newReq);
		} else {
			res = await Http.asyncPost(newReq);
		}
		if (res && res.err == 4) {
			let authorization = await this.login();
			if (authorization) {
				return this.asyncHttpPost(req);
			} else {
				throw new Error("login fail");
			}
		}
		return res;
	}

	httpGet(req: HttpRequest) {
		console.log("Http get");
		if (this.isLocal) {
			return req.success(req.defaultRes);
		}
		const newReq = this.urlWithHost(req);
		if (cc.sys.platform == cc.sys.WECHAT_GAME) {
			Wechat.httpGet(newReq);
			return;
		}
		Http.get(req);
	}
	httpPost(req: HttpRequest) {
		console.log("Http post");
		if (this.isLocal) {
			return req.success(req.defaultRes);
		}
		const newReq = this.urlWithHost(req);
		if (cc.sys.platform == cc.sys.WECHAT_GAME) {
			Wechat.httpPost(newReq);
			return;
		}
		Http.post(req);
	}

	async getUserInfo(askPrefab?: cc.Prefab) {
		if (!this.userInfo) {
			if (this.isGuest) {
				this.userInfo = {
					nickName: this.account,
				}
			} else if (cc.sys.platform == cc.sys.WECHAT_GAME) {
				const wxInfo = await Wechat.getUserInfo(askPrefab);
				if (wxInfo) {
					this.userInfo = {
						avatarUrl: wxInfo.avatarUrl,
						nickName: wxInfo.nickName
					}
				}
			} else if (cc.sys.isNative) {
				// TODO
			} else {
				this.userInfo = {
					nickName: this.account
				}
			}
		}
		return this.userInfo;
	}

	async getKV(key: string) {
		try {
			const res = await this.asyncHttpPost({
				url: "/center/user/get_value",
				data: {
					appname: this.appname,
					key
				}
			});
			cc.sys.localStorage.setItem(key, res.value);
			return res.value;
		} catch (error) {
			console.log("网络异常，取本地数据");
			return cc.sys.localStorage.getItem(key);
		}
	}
	async setKV(key: string, value?: string) {
		cc.sys.localStorage.setItem(key, value);
		return this.asyncHttpPost({
			url: "/center/user/set_value",
			data: {
				appname: this.appname,
				key,
				value,
			}
		});
	}

	wsOpen() {
		if (this.ws) {
			this.ws.open();
		}
	}

	async wsCall(req: WsRequest) {
		if (!this.ws) {
			return req.defaultRes;
		}
		return this.ws.call(req);
	}

};

export default new Network();