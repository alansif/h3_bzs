const util = require("util");
const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const port = 8115;

app.use(express.static(path.resolve('../h3_bzc/dist')));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "*");
//    res.header("Content-Type", "application/json;charset=utf-8");
    next();
});

const mysql = require('mysql');

const conn = mysql.createPool({
    host:       '192.168.160.201',
    user:       'root',
    password:   '1234',
    database:   'business',
    dateStrings: true,
    supportBigNumbers: true
});

const query = util.promisify(conn.query).bind(conn);

app.post('/api/login', function(req, res){
    const username = req.body['username'] || '';
    const password = req.body['password'] || '';
    let f = async function() {
        try{
            const rows = await query("select * from account where username = ? and password = md5(?)", [username, password]);
            if (rows.length === 0) {
                res.status(401).end();
            } else {
                res.status(200).json(rows);
            }
        } catch(err) {
            res.status(500).end();
            console.error(err);
        }
    };
    f();
});

app.post('/api/passwd', function(req, res){
    const username = req.body['username'] || '';
    const oldpass = req.body['oldpass'] || '';
    const newpass = req.body['newpass'] || '';
    let f = async function() {
        try{
            const rows = await query("update account set password = md5(?) where username = ? and password = md5(?)", [newpass, username, oldpass]);
            if (rows.affectedRows === 0) {
                res.status(401).end();
            } else {
                res.status(200).json(rows);
            }
        } catch(err) {
            res.status(500).end();
            console.error(err);
        }
    };
    f();
});

app.get('/api/logs', function(req, res){
    let f = async function() {
        try{
            const rows = await query("select * from logs");
            res.status(200).json(rows);
        } catch(err) {
            res.status(500).end();
            console.error(err);
        }
    };
    f();
});

app.get('/api/data', function(req, res){
    let f = async function() {
        try{
            const rows = await query("select * from orders where 作废=0");
            res.status(200).json(rows);
        } catch(err) {
            res.status(500).end();
            console.error(err);
        }
    };
    f();
});

function doUpdate(id, data, user, res) {
    let fns = Object.keys(data).join();
    let sqlstr0 = `select ${fns} from orders where id = ${id}`;     //取得原先的值
    let sqlstr1 = "insert into logs(tablename,action,rowid,fieldname,valuefrom,valueto,operator,transaction) values";
    let keys = Object.keys(data).map(k => k + ' = ?').join();
    let values = Object.values(data);
    const utstr = `, 最后修改时间 = CURRENT_TIMESTAMP, 最后修改者 = '${user}'`;
    let sqlstr = "update orders set " + keys + utstr + " where id = " + id;
    let f = async function() {
        try {
            let rows_uuid = await query('select uuid() as uid');
            const uid = rows_uuid[0].uid;
            let rows0 = await query(sqlstr0);
            let s = Object.entries(rows0[0]).map(v => `('orders','update',${id},'${v[0]}','${v[1]}','${data[v[0]]}','${user}','${uid}')`).join();
            await query(sqlstr1 + s);
            let rows = await query(sqlstr, values);
            res.status(200).json(rows);
        } catch(error) {
            console.error(error);
            res.status(500).end();
        }
    };
    f();
}

function doInsert(data, user, res) {
    const jsondata = JSON.stringify(data);
    data['创建者'] = user;
    let sqlstr1 = "insert into logs(tablename,action,rowid,operator,transaction,jsondata) values";
    let f = async function() {
        try {
            let rows_uuid = await query('select uuid() as uid');
            const uid = rows_uuid[0].uid;
            let rows0 = await query('insert into orders set ?', data);
            rows0.tid = rows0.insertId;
            await query(sqlstr1 + `('orders','insert',${rows0.insertId},'${user}','${uid}','${jsondata}')`)
            res.status(200).json(rows0);
        } catch(error) {
            console.error(error);
            res.status(500).end();
        }
    }
    f();
}

function doImportOne(data, user, tid) {
    const jsondata = JSON.stringify(data);
    data['创建者'] = user;
    const sqlstr1 = "insert into logs(tablename,action,rowid,operator,transaction,jsondata) values";
    let f = async function() {
        let rows0 = await query('insert into orders set ?', data);
        await query(sqlstr1 + `('orders','import',${rows0.insertId},'${user}','${tid}','${jsondata}')`)
    }
    return f();
}

app.post('/api/bulkcheck', function(req, res){
    if (!Array.isArray(req.body)) {
        res.status(400).end();
        return;
    }
    let f = async function() {
        try {
            let r = [];
            for (const v of req.body) {
                const v1 = v['证件号'];
                const v2 = v['项目'];
                const rows = await query("select * from orders where 作废=0 and 证件号=? and 项目=? and datediff(SYSDATE(), 创建时间) < 180", [v1, v2]);
                if (rows.length > 0) {
                    r.push(v.id);
                }
            }
            res.status(200).json({ids:r});
        } catch(error) {
            console.error(error);
            res.status(500).json(error);
        }
    };
    f();
});

app.post('/api/bulksave', function(req, res){
    let f = async function() {
        try {
            let rows_uuid = await query('select uuid() as uid');
            const tid = rows_uuid[0].uid;
            for (let v of req.body.data) {
                delete v.id;
                console.log(v);
                await doImportOne(v, req.body.user, tid)
            }
            res.status(200).end();
        } catch(error) {
            console.error(error);
            res.status(500).json(error);
        }
    };
    f();
});

function doDelete(id, data, user, res) {
    let sqlstr1 = "insert into logs(tablename,action,rowid,operator) values";
    let f = async function() {
        try {
            let rows0 = await query('update orders set 作废=1 where id=?', id);
            await query(sqlstr1 + `('orders','delete',${id},'${user}')`)
            res.status(200).json(rows0);
        } catch(error) {
            console.error(error);
            res.status(500).end();
        }
    }
    f();
}

app.post('/api/data', function(req, res){
    let body = req.body;
    delete body.data.head;
    const user = body.data.user.slice(0);
    delete body.data.user;
    console.log(body);
    if (body.action === "updated") {
        doUpdate(body.id, body.data, user, res);
    } else if (body.action === "inserted") {
        doInsert(body.data, user, res);
    } else if (body.action === "deleted") {
        doDelete(body.id, body.data, user, res);
    }
});

app.listen(port, () => {
    console.log("Server is running on port " + port + "...");
});
