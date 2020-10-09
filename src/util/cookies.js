/**
 * 获取cookie
 * @returns {object} getCookies
 */
export const getCookies = () => {
    const cookie = document.cookie;
    const cookiesObject = {};
    if (!cookie) return cookiesObject;
    const cookies = cookie.split(';');
    cookies.forEach(item => {
        const [key, value] = item.split('=');
        const keyName = key.trim();
        const itemObject = {
            [keyName]: value
        };
        Object.assign(cookiesObject, itemObject);
    });
    return cookiesObject;
};
