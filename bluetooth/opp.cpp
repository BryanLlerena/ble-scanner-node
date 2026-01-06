#include "opp.h"
#include "ui_opp.h"
#include <QPushButton>
#include <QDir>
#include <QDebug>

#define FILE_PATH "/data/misc/bluetooth"
int times;
int receive_flag;

opp::opp(QWidget *parent) :
    QWidget(parent),
    ui(new Ui::opp)
{
    receive_flag = 0;
    times = 0;
    ui->setupUi(this);
    setWindowTitle("bttest");
    timer = new QTimer(this);
    connect(timer, SIGNAL(timeout()), this, SLOT(timerTimeOut()));
    timer->start(1000);
}

opp::~opp()
{
    delete ui;
    timer->stop();
}

void opp :: timerTimeOut()
{
    times ++;

    if(read_config("receive") == "1" && receive_flag == 0)    //收到文件
    {
         showInformationMessage("Bluetooth data received");
         receive_flag = 1;
         times = 0;
         receiveBt_enable(1);
    }

    if(receive_flag == 2 && read_config("receive_finish") == "1")
    {
        showSuccessfulMessage("Reception is complete");
        receive_flag = 0;
        ui->receive->setDisabled(0);
        init_config();
        receiveBt_enable(0);
    }

    if(receive_flag == 1 && times > 20)
    {
       showWarningMessage("Operation timed out");
       receive_flag = 0;
       ui->receive->setDisabled(0);
       receiveBt_enable(0);
    }
    if(receive_flag == 2 && times > 300)
    {
       showWarningMessage("Received data timed out");
       receive_flag = 0;
       ui->receive->setDisabled(0);
       receiveBt_enable(0);
    }
}

void opp::on_search_clicked()
{
    ui->listWidget->clear();
    QDir file(FILE_PATH);
    if (file.exists()) {
        QStringList fileNames = file.entryList(QDir::Files);
        ui->listWidget->addItems(fileNames);
    } else {
        ui->listWidget->addItem("The path does not exist");
    }
}

void opp::on_send_clicked()
{
    QListWidgetItem *selectedItem = ui->listWidget->currentItem();
    if (selectedItem) {
        qDebug() << selectedItem->text();
        emit btsend(selectedItem->text());
    }
    else{
        showWarningMessage("Please select one file");
    }


}

void opp::on_receive_clicked()
{

    if(receive_flag == 1){
        cmd_write("accept");
        ui->receive->setDisabled(1);
        times = 0;
        receive_flag = 2;
    }

}

void opp::on_close_clicked()
{
    this->close();
    init_config();
}

void opp::sendBt_enable(bool sta)
{
    ui->search->setDisabled(sta);
    ui->receive->setDisabled(sta);
    ui->send->setDisabled(sta);
}

void opp::receiveBt_enable(bool sta)
{
    ui->search->setDisabled(sta);
    ui->send->setDisabled(sta);
}
