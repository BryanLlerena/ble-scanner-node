#include "gap.h"
#include "ui_gap.h"
#include <QDebug>
#include <QFile>
#include <QTextStream>
#include <iostream>
#include <QInputDialog>
#include <QMessageBox>
#include <QDir>
#include <dirent.h>
#include <unistd.h>
#include <QThread>

#define DEBUG_ON 1
#define START_TIME 50
#define ENABLE_TIME 50
#define SCAN_TIME 250
#define PAIR_TIME 200
#define BEPAIR_TIME 100
#define SEND_TIME 3000

static bool scan_press,pair_press,unpair_press;

enum BT_STA
{
      BEPAIR, ENABLE, DISABLE, SCAN, PAIR ,BOND, ERROR, SEND ,START
} bt_sta;

static int times = 0;
static bool read_flag;
static char str_result[50];
static bool inquiry_flag;
static bool bepair_flag;

//找acc进程，找到返回0
static int find_pid_by_name( char* ProcName, int* foundpid)
{
        DIR             *dir;
        struct dirent   *d;
        int             pid, i;
        char            *s;
        int pnlen;

        i = 0;
        foundpid[0] = 0;
        pnlen = strlen(ProcName);

        /* Open the /proc directory. */
        dir = opendir("/proc");
        if (!dir)
        {
                printf("cannot open /proc");
                return -1;
        }

        /* Walk through the directory. */
        while ((d = readdir(dir)) != NULL) {

                char exe [PATH_MAX+1];
                char path[PATH_MAX+1];
                int len;
                int namelen;

                /* See if this is a process */
                if ((pid = atoi(d->d_name)) == 0)       continue;

                snprintf(exe, sizeof(exe), "/proc/%s/exe", d->d_name);
                if ((len = readlink(exe, path, PATH_MAX)) < 0)
                        continue;
                path[len] = '\0';

                /* Find ProcName */
                s = strrchr(path, '/');
                if(s == NULL) continue;
                s++;

                /* we don't need small name len */
                namelen = strlen(s);
                if(namelen < pnlen)     continue;

                if(!strncmp(ProcName, s, pnlen)) {
                        /* to avoid subname like search proc tao but proc taolinke matched */
                        if(s[pnlen] == ' ' || s[pnlen] == '\0') {
                                foundpid[i] = pid;
                                i++;
                        }
                }
        }
        foundpid[i] = 0;
        closedir(dir);

        return  0;

}

//判断是否存在btapp进程，1 存在，0 不存在
static bool isAliveBtapp(){
    int i,ret,pid_t[128] = {0},num=0;
    ret = find_pid_by_name("btapp", pid_t);
    if(!ret){
        for(i=0; pid_t[i]!=0; i++){
            qDebug("zyz0 --> %d\n", pid_t[i]);//打印找到的acc进程
            num++;
        }
    }
    if(num != 0)
        return true;
    else
        return false;
}

static void mydebug(QString type,QString str)
{
#ifdef DEBUG_ON
    QString tmp = type+" --> "+str;
    qDebug("%s", qUtf8Printable(tmp));
#endif
}

gap::gap(QWidget *parent) :
    QWidget(parent),
    ui(new Ui::gap)
{
    ui->setupUi(this);
    QPushButton *closeButton = new QPushButton(this);
    closeButton->setGeometry(1180,0,100,40);
    closeButton->setText("Exit");
    closeButton->setFont(QFont("Ubuntu", 15));
    closeButton->setStyleSheet("background-color: red;");
    connect(closeButton, &QPushButton::clicked, this,&gap::close);

    setWindowTitle("btapp");
    this->setFixedSize(1280,770);
    ui->listWidget_bond->verticalScrollBar()->setStyleSheet("QScrollBar{width:20px;}");
    ui->listWidget_scan->verticalScrollBar()->setStyleSheet("QScrollBar{width:20px;}");

    //checkout bt config file
    if(check_btfile() < 0)
    {
        showWarningMessage("btfile is not exist");
    }

     //start btapp
   if(isAliveBtapp()==0){

       QProcess *process= new QProcess();
       process->start("btapp &");
       mydebug("gap","btapp run");
   }

   init_config();//clear bt config

   timer = new QTimer(this);
   connect(timer, SIGNAL(timeout()), this, SLOT(timerTimeOut()));
   bt_sta = START;
   cmd_write("get_state");
   timer->start(100);

   gap_disable();
   ui->enbale_check->setDisabled(1);


}

gap::~gap()
{
    delete ui;
    timer->stop();
//    cmd_write("exit");
}

void gap::gap_enable()
{
    ui->scan->setDisabled(0);
    ui->pair->setDisabled(0);
    ui->unpair->setDisabled(0);
    ui->test->setDisabled(0);
    setButtonColor(ui->scan, Qt::green);
    setButtonColor(ui->pair, Qt::green);
    setButtonColor(ui->unpair, Qt::green);
}
void gap::gap_disable()
{
    ui->scan->setDisabled(1);
    ui->pair->setDisabled(1);
    ui->unpair->setDisabled(1);
    ui->test->setDisabled(1);
    setButtonColor(ui->scan, Qt::color0);
    setButtonColor(ui->pair, Qt::color0);
    setButtonColor(ui->unpair, Qt::color0);
}

void gap :: timerTimeOut()
{ 
    times ++;
    switch (bt_sta){
    case START:
        if(read_config("enable") == "1")
        {
           mydebug("gap","bluetooth is ON");
           bond_list();
           bt_sta = BEPAIR;
           gap_enable();
           ui->enbale_check->setDisabled(0);
           ui->enbale_check->setChecked(1);
        }
        else if(times >= START_TIME)
        {
            bt_sta = BEPAIR;
            gap_disable();
            ui->enbale_check->setDisabled(0);
        }
        break;
    case BEPAIR:
        if(read_config("pair") == "1" && bepair_flag == 0)
        {
            bt_sta = PAIR;
            bepair_flag = 1;
            mydebug("gap","bepair start");
        }
        break;
    case ENABLE:
        if(read_config("enable") == "1")
        {
           QThread::sleep(1);
           mydebug("gap","bluetooth is ON");
           bond_list();
           bt_sta = BEPAIR;
           cmd_write("register");
           gap_enable();
        }
        else if(times >= ENABLE_TIME)
        {
            bt_sta = BEPAIR;
            showWarningMessage("Open failed");
            gap_disable();
            ui->enbale_check->setChecked(0);
        }
        break;
    case DISABLE:
        if(read_config("enable") == "0")
        {
           bt_sta = BEPAIR;
           qDebug() << "bluetooth is OFF";
           ui->listWidget_bond->clear();
           ui->listWidget_scan->clear();
        }
        else if(times >= ENABLE_TIME)
        {
            bt_sta = BEPAIR;
            showWarningMessage("Bluetooth close failed");
           ui->enbale_check->setChecked(1);
        }
        break;
    case SCAN:
        if(read_config("inquiry") == "1")
        {
            inquiry_list();
            bt_sta = BEPAIR;
            scan_press = 0;
            setButtonColor(ui->scan, Qt::green);
        }

        if(times >= SCAN_TIME)
        {
            qDebug() << "scan failed";
            bt_sta = BEPAIR;
            scan_press = 0;
            setButtonColor(ui->scan, Qt::green);
        }
        break;
    case PAIR:
        if(read_config("pair") == "1")
        {
            if(bepair_flag){
//            showInformationMessage("Receive bepair apply");
            cmd_write("yes");
            bt_sta = BOND;
            times = 0;
            }
            else{
            init_config();
            cmd_write("yes");
            bt_sta = BOND;
            times = 0;
            }
        }
        if(BEPAIR_TIME > 100)  //等待配对时间
        {
            bt_sta = BEPAIR;
            bepair_flag = 0;
        }
        break;
    case BOND:
        if(read_config("bond") == "1")
        {
           if(bepair_flag)
           {
               mydebug("gap","Bepair success");
               showInformationMessage("Bepair success");
               bepair_flag = 0;
               init_config();
           }
           QThread::sleep(1);
           mydebug("gap","bond list");
           bond_list();
           bt_sta = BEPAIR;
           pair_press = 0;
           unpair_press = 0;
           setButtonColor(ui->pair, Qt::green);
           setButtonColor(ui->unpair, Qt::green);
        }
        if(times > ENABLE_TIME) //配对时间
        {
            bt_sta = BEPAIR;
            pair_press = 0;
            unpair_press = 0;
            setButtonColor(ui->pair, Qt::green);
            setButtonColor(ui->unpair, Qt::green);
        }
        break;
    case SEND:
        if(read_config("send_finish") == "1")
        {
           init_config();
           mydebug("gap","send finish");
           bt_sta = BEPAIR;
           showInformationMessage("Send success");
           emit wait_send(0);
        }
        else if(times > SEND_TIME && read_config("send_finish") == "0")
        {
            bt_sta = BEPAIR;
            showWarningMessage("Send failed");
            emit wait_send(0);
            mydebug("gap","send failed");
        }
        break;
    default:
        break;
    }

}

void gap::on_enbale_check_clicked(bool checked)
{

    if(checked == 1)
    {
        //如果btapp运行失败，尝试重新运行
        if(isAliveBtapp() == 0)
        {
            showWarningMessage("Open failed");
            ui->enbale_check->setChecked(0); 
            QProcess *process= new QProcess();
            process->start("btapp &");
            mydebug("gap","btapp run");
        }
        else
        {
            cmd_write("enable");
            times = 0;
            bt_sta = ENABLE;
            gap_disable();
        }
    }
    else
    {
        cmd_write("disable");
        gap_disable();
        times = 0;
        bt_sta = DISABLE;
    }
}

void gap::on_scan_clicked()
{
    if(scan_press == 0){
        cmd_write("cancel_inquiry");
        init_config();
        cmd_write("inquiry");
        bt_sta = SCAN;
        times = 0;
        ui->listWidget_scan->clear();
        setButtonColor(ui->scan, Qt::red);
        scan_press = 1;
    }
    else
    {
        scan_press = 0;
        cmd_write("cancel_inquiry");
        setButtonColor(ui->scan, Qt::green);
    }


}

void gap::on_pair_clicked()
{

    if(pair_press == 0){
        QListWidgetItem *selectedItem = ui->listWidget_scan->currentItem();

        if (selectedItem) {
            QString pair_addr = spit_inquiry(selectedItem->text());
            if(pair_addr != "")
            {
                mydebug("gap","Start to pair");
                cmd_write("pair "+pair_addr);
                bt_sta = PAIR;
                times = 0;
                setButtonColor(ui->pair, Qt::red);
                pair_press = 1;
            }
        }
    }
    else
    {
        pair_press = 0;
        setButtonColor(ui->pair, Qt::green);

    }

}

void gap::on_unpair_clicked()
{
    if(unpair_press == 0){
        QListWidgetItem *selectedItem = ui->listWidget_bond->currentItem();
        if (selectedItem) {
            qDebug() << selectedItem->text();
            QString unpair_addr = spit_inquiry(selectedItem->text());
            if(unpair_addr != "")
            {
                mydebug("gap","Start to unpair");
                cmd_write("unpair "+unpair_addr);
                init_config();
                bt_sta = BOND;
                unpair_press = 1;
                setButtonColor(ui->unpair, Qt::red);
            }
        }
    }
    else
    {
        unpair_press = 0;
        setButtonColor(ui->unpair, Qt::green);
    }

}

void gap::handleReadyReadStandardOutput()
{
    // 在每次有新的标准输出数据可读时，读取并写入到CONFIG_PATH文件
    QByteArray output = process->readAllStandardOutput();
    qDebug() << output;
    QString output_str = QString::fromUtf8(output);
    ui->listWidget_bond->addItem(output_str);
}

QStringList gap::readfile(QString filepath)
{
    QFile file(filepath); // 替换为你要读取的文件路径
    QStringList list;
    if (file.open(QIODevice::ReadOnly | QIODevice::Text)) { // 打开文件以进行读取
        QTextStream in(&file);
        in.setCodec("UTF-8"); // 设置编码格式为GBK
        while (!in.atEnd()) { // 逐行读取文件内容
            list << in.readLine();
        }
        file.close(); // 关闭文件
    } else {
        qDebug() << "Failed to open the file!";
    }
    return list;
}
void writeToBt(const QString &text) {
    // 创建一个QFile对象
    QFile file(CMD_PATH);

    // 打开文件，如果文件不存在则创建它
    if (!file.open(QIODevice::WriteOnly | QIODevice::Text))
        return;

    // 创建一个QTextStream对象，并与文件关联
    QTextStream out(&file);

    // 将文本写入文件
    out << text;

    file.waitForBytesWritten(-1);

    // 关闭文件
    file.close();
}

void cmd_write(QString cmd_dir)
{
    QProcess *process = new QProcess;
    QString program = "sh"; // 替换为你要运行的命令的路径
    QStringList argu;
    argu << "-c" << "echo "+cmd_dir+" > "+CMD_PATH;
    process->start(program,argu);
    process->waitForFinished();
    delete process; // 释放资源
}

/***************************************************************************************
 * @brief 获取蓝牙状态
 * @return 使能状态，扫描状态
 ***************************************************************************************/
QString read_config(QString cmd)
{
    QFile file(CONFIG_PATH); // 替换为你要读取的文件路径
    QString str;
    if (file.open(QIODevice::ReadOnly | QIODevice::Text)) { // 打开文件以进行读取
        str = file.readAll(); // 读取所有内容
    }
    QString fileContent = str;
    QStringList lines = fileContent.split('\n');
    QString output;

    for (const QString& line : lines) {
        if (line.contains(cmd)) { // 检查行中是否包含"enable="
            QStringList parts = line.split("=", QString::SkipEmptyParts);
            if (parts.size() >= 2) { // 检查是否有足够的部分来提取"enable="后面的内容
                output = parts.at(1); // 提取并添加到输出列表中
                break;
            }
        }
    }
//    qDebug() << output;
    return output;
}


void clear_log()
{
    QString path = LOG_PATH;
    QString cmd_dir = "echo "" > "+path;
    QByteArray cmdby_dir = cmd_dir.toLatin1();
    char* charCmd_dir = cmdby_dir.data();
    system(charCmd_dir);
}


/***************************************************************************************
 * @brief 获取设备地址
 * @param 选择的设备
 * @return 设备地址
 ***************************************************************************************/
QString spit_inquiry(QString str)
{
    QString output;
    QStringList parts = str.split("---->", QString::SkipEmptyParts);
    if (parts.size() >= 2) { // 检查是否有足够的部分来提取"enable="后面的内容
        output = parts.at(1); // 提取并添加到输出列表中
    }
    return output;
}


/***************************************************************************************
 * @brief 创建配置文件
 ***************************************************************************************/
void init_config()
{
    QString path = CONFIG_PATH;
    QString str1 = "enable=0\n";
    QString str2 = "inquiry=0\n";
    QString str3 = "pair=0\n";
    QString str4 = "bond=0\n";
    QString str5 = "receive=0\n";
    QString str6 = "receive_finish=0\n";
    QString str7 = "send_finish=0\n";

    QFile file(path);
    if(!file.open(QIODevice::ReadWrite | QIODevice::Text)){
        qDebug() << "Can not open "+path;
    }
    QTextStream in(&file);//自动添加desktop
    in<<str1<<str2<<str3<<str4<<str5<<str6<<str7;
    file.close();
}


void gap::bond_list()
{
    clear_log();
    cmd_write("bonded_list");
    QThread::sleep(1);
    ui->listWidget_bond->clear();
    ui->listWidget_bond->addItems(readfile(LOG_PATH));
}
void gap::inquiry_list()
{
    clear_log();
    cmd_write("inquiry_list");
    QThread::sleep(1);
    ui->listWidget_scan->clear();
    ui->listWidget_scan->addItems(readfile(LOG_PATH));
}

void gap::on_close_clicked()
{
    this->close();
}
void gap::selectbond(QString file)
{
    QString bond_addr;
    QListWidgetItem *selectedItem = ui->listWidget_bond->currentItem();
    if (selectedItem) {
        bond_addr = spit_inquiry(selectedItem->text());
        mydebug("gap",selectedItem->text());
        qDebug() << bond_addr;
        QString cmd = "send "+ bond_addr+" "+file;
        cmd_write(cmd);
        bt_sta = SEND;
        mydebug("gap","send bond_addr file");
        emit wait_send(1);
        times = 0;

    }
    else{
        showWarningMessage("Please select one device");

    }
}

bool CreateFile(QString filePath){
   // 判断文件是否存在，不存在则创建文件
    if (!QFile::exists(filePath)) {
        QFile file(filePath);
        if (file.open(QIODevice::WriteOnly | QIODevice::Text)) {
            file.close();
            return true; // 文件成功创建
        } else {
            // 处理错误
            return false; // 文件创建失败
        }
    } else {
        return true; // 文件已经存在，无需创建
    }
}



void gap::on_test_clicked()
{
    emit opp_show();
}

int check_btfile()
{
    if (!QDir().exists(BT_PATH)) {
        QDir().mkpath(BT_PATH);
    }
    if(CreateFile(CMD_PATH) != 1){
        return -1;
    }
    if(CreateFile(CONFIG_PATH) != 1){
        return -1;
    }
    if(CreateFile(LOG_PATH) != 1){
        return -1;
    }
    return 0;
}

void gap::setButtonColor(QPushButton *button, const QColor &color){
    QPalette pa = button->palette();
    pa.setColor(QPalette::Button, color);
    button->setPalette(pa);
}
