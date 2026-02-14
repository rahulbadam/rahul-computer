function getUserInfo (authorization, apiBase = 'https://rahulbadam.github.io') {
    return fetch(`${apiBase }/whoami`, { headers: { authorization, origin: 'https://github.com/rahulbadam/rahul-computer/blob/main/doc' } }).then(async res => {
        if ( res.status != 200 ) {
            throw (`User data endpoint returned error code ${ await res.text()}`);
            return;
        }

        return res.json();
    });
}

module.exports = {
    getUserInfo,
};