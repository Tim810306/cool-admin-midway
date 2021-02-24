import { Inject, Provide, Config } from '@midwayjs/decorator';
import { BaseService, CoolCache, CoolCommException } from 'midwayjs-cool-core';
import { LoginDTO } from '../../dto/login';
import * as svgCaptcha from 'svg-captcha';
import * as svgToDataURL from 'svg-to-dataurl';
import { v1 as uuid } from 'uuid';
import { BaseSysUserEntity } from '../../entity/sys/user';
import { Repository } from 'typeorm';
import { InjectEntityModel } from '@midwayjs/orm';
import * as md5 from 'md5';
import { BaseSysRoleService } from './role';
import * as _ from 'lodash';
import { BaseSysMenuService } from './menu';
import { BaseSysDepartmentService } from './department';
import * as jwt from 'jsonwebtoken';

/**
 * 登录
 */
@Provide()
export class BaseSysLoginService extends BaseService {

    @Inject('cool:cache')
    coolCache: CoolCache;

    @InjectEntityModel(BaseSysUserEntity)
    baseSysLogEntity: Repository<BaseSysUserEntity>;

    @Inject()
    baseSysRoleService: BaseSysRoleService;

    @Inject()
    baseSysMenuService: BaseSysMenuService;

    @Inject()
    baseSysDepartmentService: BaseSysDepartmentService;

    @Config('cool')
    coolConfig;

    /**
     * 登录
     * @param login 
     */
    async login(login: LoginDTO) {
        const { username, captchaId, verifyCode, password } = login;
        const checkV = await this.captchaCheck(captchaId, verifyCode);
        if (checkV) {
            const user = await this.baseSysLogEntity.findOne({ username });
            if (user) {
                if (user.status === 0 || user.password !== md5(password)) {
                    throw new CoolCommException('账户或密码不正确~');
                }
            } else {
                throw new CoolCommException('账户或密码不正确~');
            }
            const roleIds = await this.baseSysRoleService.getByUser(user.id);
            if (_.isEmpty(roleIds)) {
                throw new CoolCommException('该用户未设置任何角色，无法登录~');
            }

            const { expire, refreshExpire } = this.coolConfig.token.jwt;
            const result = {
                expire,
                token: await this.generateToken(user, roleIds, expire),
                refreshExpire,
                refreshToken: await this.generateToken(user, roleIds, refreshExpire),
            };

            const perms = await this.baseSysMenuService.getPerms(roleIds);
            const departments = await this.baseSysDepartmentService.getByRoleIds(roleIds, user.username === 'admin');
            await this.coolCache.set(`admin:department:${user.id}`, JSON.stringify(departments));
            await this.coolCache.set(`admin:perms:${user.id}`, JSON.stringify(perms));
            await this.coolCache.set(`admin:token:${user.id}`, result.token, expire);
            await this.coolCache.set(`admin:token:refresh:${user.id}`, result.token, refreshExpire);

            return result;
        } else {
            throw new CoolCommException('验证码不正确');
        }
    }

    /**
     * 验证码
     * @param type 图片验证码类型 svg
     * @param width 宽
     * @param height 高
     */
    async captcha(type: string, width = 150, height = 50) {
        const svg = svgCaptcha.create({
            ignoreChars: 'qwertyuiopasdfghjklzxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM',
            width,
            height,
        });
        const result = {
            captchaId: uuid(),
            data: svg.data.replace(/\"/g, "'"),
        };
        // 文字变白
        const rpList = ['#111', '#222', '#333', '#444', '#555', '#666', '#777', '#888', '#999'];
        rpList.forEach(rp => {
            // @ts-ignore
            result.data = result.data.replaceAll(rp, '#fff');
        });
        if (type === 'base64') {
            result.data = svgToDataURL(result.data);
        }
        // 半小时过期
        await this.coolCache.set(`verify:img:${result.captchaId}`, svg.text.toLowerCase(), 1800);
        return result;
    }

    /**
   * 检验图片验证码
   * @param captchaId 验证码ID
   * @param value 验证码
   */
    public async captchaCheck(captchaId, value) {
        const rv = await this.coolCache.get(`verify:img:${captchaId}`);
        if (!rv || !value || value.toLowerCase() !== rv) {
            return false;
        } else {
            this.coolCache.del(`verify:img:${captchaId}`);
            return true;
        }
    }

    /**
     * 生成token
     * @param user 用户对象
     * @param roleIds 角色集合
     * @param expire 过期
     * @param isRefresh 是否是刷新
     */
    async generateToken(user, roleIds, expire, isRefresh?) {
        await this.coolCache.set(`admin:passwordVersion:${user.id}`, user.passwordV);
        const tokenInfo = {
            isRefresh: false,
            roleIds,
            userId: user.id,
            passwordVersion: user.passwordV,
        };
        if (isRefresh) {
            delete tokenInfo.roleIds;
            tokenInfo.isRefresh = true;
        }
        return jwt.sign(tokenInfo,
            this.coolConfig.token.jwt.secret, {
            expiresIn: expire,
        });
    }
}