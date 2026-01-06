#ifndef GAP_H
#define GAP_H

#include <QWidget>
#include <QTimer>
#include <QProcess>
#include <QString>
#include "opp.h"
#include <QPushButton>
#include <QScrollBar>
#include "../messagebox/messagebox.h"


#define CMD_PATH "/usr/bin/application/bt/file.txt"
#define LOG_PATH "/usr/bin/application/bt/log.txt"
#define CONFIG_PATH "/usr/bin/application/bt/bt.confg"
#define BT_PATH "/usr/bin/application/bt"

namespace Ui {
class gap;
}

class gap : public QWidget
{
    Q_OBJECT

public:
    explicit gap(QWidget *parent = 0);
    ~gap();
     Ui::gap *ui;

private:
    QTimer *timer;
    QProcess *process;
    void setButtonColor(QPushButton *button, const QColor &color);
    void gap_enable();
    void gap_disable();

    void showWarningMessage(const QString &msg){
        MessageBox* pMsgBox = new MessageBox(this, SA_OKS, SA_WARNING);
        pMsgBox->setAttribute(Qt::WA_ShowModal, true);
        pMsgBox->setWindowFlags( Qt::FramelessWindowHint | Qt::WindowStaysOnTopHint | Qt::Dialog);
        pMsgBox->SetTips(msg);
        pMsgBox->show();
    }
    void showInformationMessage(const QString &msg){
        MessageBox* pMsgBox = new MessageBox(this, SA_OKS, SA_TIPS);
        pMsgBox->setAttribute(Qt::WA_ShowModal, true);
        pMsgBox->setWindowFlags( Qt::FramelessWindowHint | Qt::WindowStaysOnTopHint | Qt::Dialog);
        pMsgBox->SetTips(msg);
        pMsgBox->show();
    }

public slots:
    void handleReadyReadStandardOutput();
    QStringList readfile(QString filepath);
    void inquiry_list();
    void bond_list();
    void selectbond(QString file);

private slots:
    void timerTimeOut();

    void on_scan_clicked();

    void on_pair_clicked();

    void on_enbale_check_clicked(bool checked);

    void on_unpair_clicked();

    void on_close_clicked();


    void on_test_clicked();

signals:
    void wait_send(int);
    void opp_show();

};
    void cmd_write(QString cmd_dir);
    void writeToBt(const QString &text);
    void clear_log();
    QString spit_inquiry(QString str);
    QString read_config(QString cmd);
    bool CreateFile(QString filePath);
    int check_btfile();
    void init_config();


#endif // GAP_H
